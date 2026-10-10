#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { cost_transcript, type SessionFile } from '#scripts/cost-runtime/cost-transcript'
import { delivered_rules } from './delivered-rules'
import { rule_value, type RuleReading } from './rule-value'
import { rule_value_cache } from './rule-value-cache'

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
const PERCENT_SIGN = '%'
const COLUMN_GAP = '  '
const NO_TARGETS = 'no measurement targets'
// A rule with no `keeps` predicate cannot be scored, so it reads as this rather than as 0% — "never
// kept" is a claim the missing predicate cannot make (`rule-value.ts`).
const UNMEASURED = 'unmeasured'
// A measurable rule no run reached: the denominator is zero, so no rate is taken over it.
const UNREACHED = 'unreached'

interface OwnedText {
	owner: string
	text: string
}

function owned_text(file: SessionFile): OwnedText | undefined {
	const text = cost_transcript.read_optional(file)

	if (text === undefined) return undefined

	return { owner: cost_transcript.owning_session_id(file), text }
}

// Every transcript grouped by the run it belongs to: a session's own file and the units it delegated
// share one `owning_session_id`, so a lane child is counted with its parent rather than as a run of
// its own — the unit `rule_value.measure` reads.
function group_by_run(files: ReadonlyArray<SessionFile>): Map<string, Array<string>> {
	const runs = new Map<string, Array<string>>()

	for (const file of files) {
		const owned = owned_text(file)

		if (owned === undefined) continue

		const texts = runs.get(owned.owner) ?? []

		texts.push(owned.text)
		runs.set(owned.owner, texts)
	}

	return runs
}

// Every run reachable from the working tree — the session's own transcript directory and any lane
// slugs beneath its main checkout — grouped into the shape `rule_value.measure` reads.
function gather_runs(cwd: string = process.cwd()): Array<Array<string>> {
	const directories = cost_transcript.transcript_directories(cwd)
	const files = cost_transcript.list_sessions_across(directories)

	return [...group_by_run(files).values()]
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

// The reading as text, or `NO_TARGETS` when nothing measurable was found — never an empty output that
// would read as a broken command.
function render(runs: ReadonlyArray<ReadonlyArray<string>>): string {
	if (runs.length === 0) return NO_TARGETS

	return rule_value
		.measure(runs)
		.map((reading) => row(reading))
		.join('\n')
}

// `--refresh` is the detached measurement the `backlogrun` loop head starts: the reading goes to the
// cache `backlog:offer` prints from, never to stdout (`rule-value-cache.ts`).
function run_rule_value(argv: ReadonlyArray<string> = [], cwd: string = process.cwd()): number {
	const reading = render(gather_runs(cwd))

	if (argv.includes(REFRESH_FLAG)) rule_value_cache.store(reading, cwd)
	else process.stdout.write(`${reading}\n`)

	return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = run_rule_value(process.argv.slice(ARGV_OFFSET))
}

const rule_value_cli = {
	group_by_run,
	render,
	row,
	run_rule_value,
	NO_TARGETS,
	UNMEASURED,
	UNREACHED,
}

export { rule_value_cli }
