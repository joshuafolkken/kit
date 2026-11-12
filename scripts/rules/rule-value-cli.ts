#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { hook_ledger_read } from '#scripts/hooks/hook-ledger-read'
import { lane_stats_request } from '#scripts/lane/lane-stats-request'
import { stamped_memo } from '#scripts/lib/stamped-memo'
import { delivered_rules } from './delivered-rules'
import { piped_verification_shapes } from './piped-verification-shapes'
import { rule_rephrase } from './rule-rephrase'
import { rule_value, type RuleReading } from './rule-value'
import { rule_value_cache, type FreshReading } from './rule-value-cache'
import { rule_value_candidates } from './rule-value-candidates'
import { rule_value_prose } from './rule-value-prose'
import { rule_value_runs, type RunSummary } from './rule-value-runs'
import { rule_value_trend } from './rule-value-trend'

// `josh rule:value` — what each delivered rule earns on the channel that carries it, one row per rule.
// `rule_value.measure` was public but had no caller outside its own test, so
// a rule that never fired stayed invisible until a person thought to measure it. This is that caller:
// it groups every transcript by the run it belongs to — a lane's transcript counted with the parent
// that dispatched it — measures them, and prints the reading.
//
// **It reports and never fails**, exactly as `josh bytes` and `josh lines` do. An environment holding
// no measurable transcript prints `NO_TARGETS` and exits zero rather than erroring, so a fresh
// checkout reads differently from a broken command.

const ARGV_OFFSET = 2
const REFRESH_FLAG = '--refresh'
const FRESH_FLAG = '--fresh'
const PROSE_FLAG = '--prose'
const PERIOD_FLAG = '--period'
const PERIOD_USAGE = 'usage: josh rule:value --period <days> — a positive number of days'
const CACHED_NOTE = 'cached reading taken at'
const PERCENT_SIGN = '%'
const COLUMN_GAP = '  '
const NO_TARGETS = 'no measurement targets'
// A rule with no `keeps` predicate cannot be scored, so it reads as this rather than as 0% — "never
// kept" is a claim the missing predicate cannot make (`rule-value.ts`).
const UNMEASURED = 'unmeasured'
// A measurable rule no run reached: the denominator is zero, so no rate is taken over it.
const UNREACHED = 'unreached'

// Every transcript grouped by the run it belongs to: a session's own file and the units it delegated
// share one `owning_session_id`, so a lane child is counted with its parent rather than as a run of
// its own — the unit `rule_value.measure` reads. **Paths only**: no text is read here, so the
// grouping never holds the corpus.
function group_by_run(files: ReadonlyArray<SessionFile>): Map<string, Array<SessionFile>> {
	const runs = new Map<string, Array<SessionFile>>()

	for (const file of files) {
		const owner = cost_transcript.owning_session_id(file)
		const owned = runs.get(owner) ?? []

		owned.push(file)
		runs.set(owner, owned)
	}

	return runs
}

// Every run reachable from the working tree — the session's own transcript directory and any lane
// slugs beneath its main checkout — summarized, reading again only the runs whose files moved since
// the stored measurement (`rule-value-runs.ts`). Without a store every run is read.
function gather_summaries(cwd: string): Array<RunSummary> {
	const directories = cost_transcript.transcript_directories(cwd)
	const runs = group_by_run(cost_transcript.list_sessions_across(directories))
	const store = rule_value_runs.open(cwd)
	const summaries = rule_value_runs.summaries_of(runs, store ?? stamped_memo.create())

	store?.save()

	return summaries
}

// The runs of the transcripts last written at or after `since_ms`.
function window_runs(cwd: string, since_ms: number): Map<string, Array<SessionFile>> {
	const files = cost_transcript.list_sessions_across(cost_transcript.transcript_directories(cwd))

	return group_by_run(files.filter((file) => file.modified_ms >= since_ms))
}

// `--period`: the window's runs read into a memo of its own — the stored per-run counts hold whole
// runs, so a window must neither read nor evict them.
function gather_window(cwd: string, since_ms: number): Array<RunSummary> {
	return rule_value_runs.summaries_of(window_runs(cwd, since_ms), stamped_memo.create())
}

function* summarized(runs: Iterable<ReadonlyArray<string>>): Generator<RunSummary> {
	for (const texts of runs) yield rule_value_runs.summarize(texts)
}

// The id column, wide enough for the longest rule id, so the reading lines up whatever the registry
// holds.
const ID_WIDTH = Math.max(...delivered_rules.MEASURED_RULES.map((rule) => rule.id.length))

function rate_text(reading: RuleReading): string {
	if (!reading.is_measurable) return UNMEASURED

	const rate = rule_value.unaided_rate(reading)

	if (rate === undefined) return UNREACHED

	return `${rate.toString()}${PERCENT_SIGN} unaided`
}

// A count column only where it is non-zero, so the rows of rules it never touched keep their shape.
function optional_column(label: string, value: number): Array<string> {
	return value > 0 ? [`${label} ${value.toString()}`] : []
}

// `rephrased` is the runs where the next call of a refused tool was allowed — the guard's
// false-positive proxy, in the same unit as `refused` (`rule-rephrase.ts`).
function row(reading: RuleReading, rephrased = 0): string {
	const id = reading.id.padEnd(ID_WIDTH)
	const reached = `reached ${reading.sessions.toString()}`
	const refused = `refused ${reading.refusals.toString()}`
	const rewritten = optional_column('rewritten', reading.rewrites)

	return [
		id,
		reached,
		rate_text(reading),
		refused,
		...rewritten,
		...optional_column('rephrased', rephrased),
	].join(COLUMN_GAP)
}

// `candidates` is set only where something measurable was found, so `NO_TARGETS` stays the whole answer.
interface Rendered {
	table: string
	candidates?: string
}

// The reading as text, or `NO_TARGETS` when nothing measurable was found — never an empty output that
// would read as a broken command.
function render_summaries(summaries: Iterable<RunSummary>): Rendered {
	const { runs, readings, shapes, rephrased } = rule_value_runs.tally(summaries)

	if (runs === 0) return { table: NO_TARGETS }

	const judged = rule_value_candidates.judge(readings, runs)

	return {
		table: readings
			.map((reading) => row(reading, rule_rephrase.rephrased_of(reading.id, rephrased)))
			.join('\n'),
		candidates: `${rule_value_candidates.render(judged, runs)}\n${piped_verification_shapes.render(shapes)}`,
	}
}

// The same reading from each run's texts, every run read.
function render_parts(runs: Iterable<ReadonlyArray<string>>): Rendered {
	return render_summaries(summarized(runs))
}

function render(runs: Iterable<ReadonlyArray<string>>): string {
	return render_parts(runs).table
}

// The cached table and when it was taken. The cache holds the table alone, so the line names the flag
// that measures now for the `candidates:` section too.
function cached_text(fresh: FreshReading): string {
	const taken_at = fresh.taken_at.toISOString()

	return `${fresh.text.trimEnd()}\n\n${CACHED_NOTE} ${taken_at} — ${FRESH_FLAG} to measure now, with candidates`
}

function print_summaries(summaries: Iterable<RunSummary>): void {
	const { table, candidates } = render_summaries(summaries)

	process.stdout.write(`${[table, candidates].filter(Boolean).join('\n\n')}\n`)
}

function print_measured(cwd: string): void {
	print_summaries(gather_summaries(cwd))
}

// The start of the `--period` window, or `undefined` when its value is not a positive number of days.
function period_since(argv: ReadonlyArray<string>): number | undefined {
	const period_days = lane_stats_request.positive(argv[argv.indexOf(PERIOD_FLAG) + 1])

	return period_days === undefined
		? undefined
		: hook_ledger_read.period_start(period_days, new Date())
}

function refuse(usage: string): number {
	process.stderr.write(`${usage}\n`)

	return 1
}

// The cache holds the all-time reading, so a period always measures and never stores.
function print_period(argv: ReadonlyArray<string>, cwd: string): number {
	const since_ms = period_since(argv)

	if (since_ms === undefined) return refuse(PERIOD_USAGE)

	print_summaries(gather_window(cwd, since_ms))

	return 0
}

// `--weekly` reads every transcript unless `--period` narrows it.
function weekly_since(argv: ReadonlyArray<string>): number | undefined {
	return argv.includes(PERIOD_FLAG) ? period_since(argv) : 0
}

// Like `--period`, the trend always measures and never touches the cache (`rule-value-trend.ts`).
function print_weekly(argv: ReadonlyArray<string>, cwd: string): number {
	const ids = rule_value_trend.requested_ids(argv)

	if (ids === undefined) return refuse(rule_value_trend.WEEKLY_USAGE)

	const since_ms = weekly_since(argv)

	if (since_ms === undefined) return refuse(PERIOD_USAGE)

	const weeks = rule_value_trend.tallies(window_runs(cwd, since_ms))

	process.stdout.write(`${rule_value_trend.render(weeks, ids) ?? NO_TARGETS}\n`)

	return 0
}

function print_reading(argv: ReadonlyArray<string>, cwd: string): void {
	const fresh = argv.includes(FRESH_FLAG) ? undefined : rule_value_cache.read_fresh(cwd)

	if (fresh === undefined) print_measured(cwd)
	else process.stdout.write(`${cached_text(fresh)}\n`)
}

// `--prose` reads the documents instead of the transcripts: every prose rule and whether a registered
// row enforces it (`rule-value-prose.ts`).
function print_prose(cwd: string): void {
	process.stdout.write(`${rule_value_prose.render(rule_value_prose.audit(cwd))}\n`)
}

function print_transcripts(argv: ReadonlyArray<string>, cwd: string): void {
	if (argv.includes(REFRESH_FLAG)) {
		rule_value_cache.store(render_summaries(gather_summaries(cwd)).table, cwd)
	} else print_reading(argv, cwd)
}

function print_windowed(argv: ReadonlyArray<string>, cwd: string): number {
	if (argv.includes(rule_value_trend.WEEKLY_FLAG)) return print_weekly(argv, cwd)
	if (argv.includes(PERIOD_FLAG)) return print_period(argv, cwd)

	print_transcripts(argv, cwd)

	return 0
}

// `--refresh` is the detached measurement the `backlogrun` loop head starts: the table goes to the
// cache `backlog:offer` prints from, never to stdout (`rule-value-cache.ts`). The candidates are read
// when a rule is retired, not at the loop head, so they print to stdout only and the cache keeps its
// shape. Bare, a reading cached inside the refresh interval is printed instead of measuring again —
// the measurement re-reads every transcript and takes minutes (joshuafolkken/kit#5186); `--fresh`
// measures regardless. `--period <days>` counts only the transcripts of that trailing window;
// `--weekly <rule-id>...` prints those rules week by week, inside that window when one is given.
function run_rule_value(argv: ReadonlyArray<string> = [], cwd: string = process.cwd()): number {
	if (argv.includes(PROSE_FLAG)) print_prose(cwd)
	else return print_windowed(argv, cwd)

	return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = run_rule_value(process.argv.slice(ARGV_OFFSET))
}

const rule_value_cli = {
	group_by_run,
	render,
	render_parts,
	render_summaries,
	row,
	run_rule_value,
	CACHED_NOTE,
	NO_TARGETS,
	PERIOD_USAGE,
	UNMEASURED,
	UNREACHED,
}

export { rule_value_cli }
