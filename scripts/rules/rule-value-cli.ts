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
// **`-` and this are two different facts, and one cell used to carry both** (joshuafolkken/kit#1642).
// `unaided_rate` is `undefined` for a rule that declares no `keeps` predicate *and* for one no run
// ever reached, and `docs/josh-commands.md` asserts only the first reading — so a rule the corpus
// simply never exercised was read as one nothing can score.
const UNREACHED = 'no runs'
const ID_WIDTH = 20
const NUMBER_WIDTH = 9
// `process.argv` is `[node, script, ...arguments]`, so the first real argument sits here.
const FIRST_ARGUMENT = 2
const HEADINGS: ReadonlyArray<string> = ['runs', 'kept', 'refused', 'unaided']

function rate_cell(reading: RuleReading): string {
	const rate = rule_value.unaided_rate(reading)

	if (rate !== undefined) return `${String(rate)}%`

	return reading.is_measurable ? UNREACHED : UNMEASURED
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
function group_runs(files: ReadonlyArray<SessionFile>): Array<Array<SessionFile>> {
	const grouped = new Map<string, Array<SessionFile>>()
	const runs: Array<Array<SessionFile>> = []

	for (const file of files) {
		const owner = cost_transcript.owning_session_id(file)
		const existing = grouped.get(owner)

		if (existing === undefined) grouped.set(owner, add_run(runs, file))
		else existing.push(file)
	}

	return runs
}

function runs_in(cwd: string): Array<Array<SessionFile>> {
	return group_runs(cost_transcript.list_sessions(cost_transcript.transcript_directory(cwd)))
}

// **A group holding only delegated units is not a run** (joshuafolkken/kit#1642). `cost-transcript.ts`
// documents the state that produces one — a project whose session files were pruned while their
// `subagents/` directories survived — and there `group_runs` keys the units under a parent that no
// longer exists, so each orphaned group is scored as a run of its own. That puts subagent
// transcripts back into the denominator, which is the miscount joshuafolkken/kit#1525 closed,
// reached from the other side. They are dropped rather than folded into a neighbor: nothing records
// which run they belonged to.
function has_own_transcript(files: ReadonlyArray<SessionFile>): boolean {
	return files.some((file) => !file.is_delegated)
}

// **Dropping them silently would be the same failure one layer down**, so the count is printed: a
// corpus that lost half its sessions to pruning reads as a smaller corpus rather than as a broken
// one, and the reader can tell which.
function orphan_line(orphaned: number): Array<string> {
	return orphaned === 0 ? [] : [`orphaned unit groups skipped: ${String(orphaned)}`]
}

// One run's texts, read only while that run is being scored.
function* read_runs(runs: ReadonlyArray<ReadonlyArray<SessionFile>>): Generator<Array<string>> {
	for (const files of runs) {
		yield files
			.map((file) => cost_transcript.read_optional(file))
			.filter((text): text is string => text !== undefined)
	}
}

// **The orphan count is composed before the empty check, not after it.** A project whose session
// files were all pruned is the state where *every* group is an orphan, so an early return that built
// the line later would say "no recorded sessions" about a corpus it had just discarded — the silent
// drop this reporting exists to prevent, in the one case it matters most.
function run(cwd: string): Array<string> {
	const grouped = runs_in(cwd)
	const runs = grouped.filter((files) => has_own_transcript(files))
	const orphans = orphan_line(grouped.length - runs.length)

	if (runs.length === 0) return ['no recorded sessions for this checkout', ...orphans]

	const readings = rule_value.measure(read_runs(runs))

	return [`runs read: ${String(runs.length)}`, ...orphans, ...report(readings)]
}

// **A checkout may be named, because a lane has no sessions of its own.** A worktree cut for one
// Issue is days old and has recorded nothing, so the default `cwd` answers "no recorded sessions"
// there — correct, and useless. Pointing it at the primary checkout reads the runs that actually
// happened under these documents.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const lines = run(process.argv[FIRST_ARGUMENT] ?? process.cwd())

	for (const line of lines) console.info(line)
}

const rule_value_cli = {
	UNMEASURED,
	UNREACHED,
	group_runs,
	has_own_transcript,
	rate_cell,
	report,
	run,
}

export { rule_value_cli }
