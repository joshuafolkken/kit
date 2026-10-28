#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { delivered_rules } from './delivered-rules'
import { piped_verification_shapes, type ShapeCounts } from './piped-verification-shapes'
import { rule_value, type RuleReading } from './rule-value'
import { rule_value_cache, type FreshReading } from './rule-value-cache'
import { rule_value_candidates } from './rule-value-candidates'

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

function readable_texts(files: ReadonlyArray<SessionFile>): Array<string> {
	return files
		.map((file) => cost_transcript.read_optional(file))
		.filter((text): text is string => text !== undefined)
}

// **One run read at a time.** Each run's text is read only when `measure` asks for it and released
// before the next is read, so the peak is the largest run rather than the whole corpus. A run whose
// every file is unreadable yields nothing, as it was never a measurement target.
function* runs_of(groups: Iterable<ReadonlyArray<SessionFile>>): Generator<Array<string>> {
	for (const files of groups) {
		const texts = readable_texts(files)

		if (texts.length > 0) yield texts
	}
}

// Every run reachable from the working tree — the session's own transcript directory and any lane
// slugs beneath its main checkout — in the shape `rule_value.measure` reads.
function gather_runs(cwd: string = process.cwd()): Generator<Array<string>> {
	const directories = cost_transcript.transcript_directories(cwd)
	const files = cost_transcript.list_sessions_across(directories)

	return runs_of(group_by_run(files).values())
}

// The `piped-verification` refusals are named by shape in the same pass, so the corpus is read once.
interface Tally {
	runs: number
	shapes: ShapeCounts
}

function* counted(
	runs: Iterable<ReadonlyArray<string>>,
	tally: Tally,
): Generator<ReadonlyArray<string>> {
	for (const texts of runs) {
		tally.runs += 1
		for (const text of texts) piped_verification_shapes.count(text, tally.shapes)
		yield texts
	}
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

function row(reading: RuleReading): string {
	const id = reading.id.padEnd(ID_WIDTH)
	const reached = `reached ${reading.sessions.toString()}`
	const refused = `refused ${reading.refusals.toString()}`
	// Only where a rewrite happened, so the rows of rules that can only refuse keep their shape.
	const rewritten = reading.rewrites > 0 ? [`rewritten ${reading.rewrites.toString()}`] : []

	return [id, reached, rate_text(reading), refused, ...rewritten].join(COLUMN_GAP)
}

// `candidates` is set only where something measurable was found, so `NO_TARGETS` stays the whole answer.
interface Rendered {
	table: string
	candidates?: string
}

// The reading as text, or `NO_TARGETS` when nothing measurable was found — never an empty output that
// would read as a broken command.
// The runs are counted as `measure` consumes them, since a lazy source cannot be asked its length
// up front.
function render_parts(runs: Iterable<ReadonlyArray<string>>): Rendered {
	const tally: Tally = { runs: 0, shapes: new Map() }
	const readings = rule_value.measure(counted(runs, tally))

	if (tally.runs === 0) return { table: NO_TARGETS }

	const judged = rule_value_candidates.judge(readings, tally.runs)
	const shapes = piped_verification_shapes.render(tally.shapes)

	return {
		table: readings.map((reading) => row(reading)).join('\n'),
		candidates: `${rule_value_candidates.render(judged, tally.runs)}\n${shapes}`,
	}
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

function print_measured(cwd: string): void {
	const { table, candidates } = render_parts(gather_runs(cwd))

	process.stdout.write(`${[table, candidates].filter(Boolean).join('\n\n')}\n`)
}

function print_reading(argv: ReadonlyArray<string>, cwd: string): void {
	const fresh = argv.includes(FRESH_FLAG) ? undefined : rule_value_cache.read_fresh(cwd)

	if (fresh === undefined) print_measured(cwd)
	else process.stdout.write(`${cached_text(fresh)}\n`)
}

// `--refresh` is the detached measurement the `backlogrun` loop head starts: the table goes to the
// cache `backlog:offer` prints from, never to stdout (`rule-value-cache.ts`). The candidates are read
// when a rule is retired, not at the loop head, so they print to stdout only and the cache keeps its
// shape. Bare, a reading cached inside the refresh interval is printed instead of measuring again —
// the measurement re-reads every transcript and takes minutes (joshuafolkken/kit#5186); `--fresh`
// measures regardless.
function run_rule_value(argv: ReadonlyArray<string> = [], cwd: string = process.cwd()): number {
	if (argv.includes(REFRESH_FLAG)) rule_value_cache.store(render_parts(gather_runs(cwd)).table, cwd)
	else print_reading(argv, cwd)

	return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = run_rule_value(process.argv.slice(ARGV_OFFSET))
}

const rule_value_cli = {
	group_by_run,
	render,
	render_parts,
	row,
	run_rule_value,
	runs_of,
	CACHED_NOTE,
	NO_TARGETS,
	UNMEASURED,
	UNREACHED,
}

export { rule_value_cli }
