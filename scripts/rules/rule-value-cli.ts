#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { cost_transcript, type SessionFile } from '#scripts/cost/cost-transcript'
import { rule_value, type RuleReading } from './rule-value'

// `pnpm josh rule:value` — what each trigger-delivered rule's carried text earns unaided
// (joshuafolkken/kit#1525).
//
// **The corpus is this checkout's own recorded sessions**, discovered exactly the way `josh time` and
// `josh cost` discover theirs. Reaching across every project directory would read runs made under
// other documents, and the question is what *these* documents earn.
//
// **A run's delegated units are folded into it, never counted beside it.** `list_sessions` returns
// each unit as its own file, and on a working checkout they outnumber the sessions several times
// over — so counting files would make most of the denominator subagent transcripts and would split
// one run's evidence in two, scoring the parent that kept a rule separately from the unit that
// reached its trigger. `owning_session_id` is the same fold `time-family.ts` applies.

const UNMEASURED = '-'
const ID_WIDTH = 20
const NUMBER_WIDTH = 9
// `process.argv` is `[node, script, ...arguments]`, so the first real argument sits here.
const FIRST_ARGUMENT = 2
const HEADINGS: ReadonlyArray<string> = ['runs', 'kept', 'refused', 'unaided']

function rate_cell(reading: RuleReading): string {
	const rate = rule_value.unaided_rate(reading)

	return rate === undefined ? UNMEASURED : `${String(rate)}%`
}

function row_of(reading: RuleReading): string {
	const counts = [reading.sessions, reading.unaided_kept, reading.refusals]
		.map((value) => String(value).padStart(NUMBER_WIDTH))
		.join('')

	return `${reading.id.padEnd(ID_WIDTH)}${counts}${rate_cell(reading).padStart(NUMBER_WIDTH)}`
}

function report(readings: ReadonlyArray<RuleReading>): Array<string> {
	const labels = HEADINGS.map((label) => label.padStart(NUMBER_WIDTH)).join('')

	return [`${'rule'.padEnd(ID_WIDTH)}${labels}`, ...readings.map((reading) => row_of(reading))]
}

function add_run(runs: Array<Array<SessionFile>>, file: SessionFile): Array<SessionFile> {
	const created = [file]

	runs.push(created)

	return created
}

// Every transcript file grouped under the run it belongs to, the units with their parent.
function runs_in(cwd: string): Array<Array<SessionFile>> {
	const directory = cost_transcript.transcript_directory(cwd)
	const grouped = new Map<string, Array<SessionFile>>()
	const runs: Array<Array<SessionFile>> = []

	for (const file of cost_transcript.list_sessions(directory)) {
		const owner = cost_transcript.owning_session_id(file)
		const existing = grouped.get(owner)

		if (existing === undefined) grouped.set(owner, add_run(runs, file))
		else existing.push(file)
	}

	return runs
}

// One run's texts, read only while that run is being scored.
function* read_runs(runs: ReadonlyArray<ReadonlyArray<SessionFile>>): Generator<Array<string>> {
	for (const files of runs) {
		yield files
			.map((file) => cost_transcript.read_optional(file))
			.filter((text): text is string => text !== undefined)
	}
}

function run(cwd: string): Array<string> {
	const runs = runs_in(cwd)

	if (runs.length === 0) return ['no recorded sessions for this checkout']

	const readings = rule_value.measure(read_runs(runs))

	return [`runs read: ${String(runs.length)}`, ...report(readings)]
}

// **A checkout may be named, because a lane has no sessions of its own.** A worktree cut for one
// Issue is days old and has recorded nothing, so the default `cwd` answers "no recorded sessions"
// there — correct, and useless. Pointing it at the primary checkout reads the runs that actually
// happened under these documents.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const lines = run(process.argv[FIRST_ARGUMENT] ?? process.cwd())

	for (const line of lines) console.info(line)
}

const rule_value_cli = { UNMEASURED, report, run }

export { rule_value_cli }
