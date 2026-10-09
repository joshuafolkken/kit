import { issue_cite } from '#scripts/issue/issue-cite'

// The workflow commands form a ladder — `kickoff` → `halfrun` → `prrun` →
// `fullrun` — and **the command typed decides only how far a run goes; where it starts is read off the
// issue**. A run that finds work already done resumes after it rather than redoing it, and a command
// whose stopping point the issue has already reached reports that and stops.
//
// This module is the pure half of that rule: the five states an issue can be found in, the four
// commands, and the one table that maps a (state, command) pair to a start and an end. `run:entry` reads
// the state (`run-stage-read.ts`) and branches on the answer; the stage table in
// `docs/how-to/run-issues.md` and each stop's `Next:` line are pinned to this module by
// `run-stage-document.test.ts`, so the prose cannot drift from what the entry does.

const KICKOFF = 'kickoff'
const HALFRUN = 'halfrun'
const PRRUN = 'prrun'
const FULLRUN = 'fullrun'

// In ladder order: a command's index plus one is the state rank it brings an issue to.
const COMMANDS = [KICKOFF, HALFRUN, PRRUN, FULLRUN] as const

type StageCommand = (typeof COMMANDS)[number]

// What `run:entry` serves when no command is named.
const DEFAULT_COMMAND: StageCommand = FULLRUN

const FRESH = 'fresh'
const PLANNED = 'planned'
const HALFRUN_STOPPED = 'halfrun-stopped'
const PRRUN_STOPPED = 'prrun-stopped'
const MERGED = 'merged'

// In ladder order: a state's index is how many rungs the issue has already climbed.
const STATES = [FRESH, PLANNED, HALFRUN_STOPPED, PRRUN_STOPPED, MERGED] as const

type StageState = (typeof STATES)[number]

const REACHED = 'reached'

// Where a run picks the issue up from each state — the first piece of work not yet done. A merged issue
// has none: every command has reached it.
const STARTS: Readonly<Record<StageState, string>> = {
	[FRESH]: 'plan',
	[PLANNED]: 'implement',
	[HALFRUN_STOPPED]: 'gate',
	[PRRUN_STOPPED]: 'followup',
	[MERGED]: REACHED,
}

// Every start a decision can print, in ladder order — the `run:entry` oracle's vocabulary.
const START_TOKENS: ReadonlyArray<string> = [...new Set(Object.values(STARTS))]

// Where each command stops.
const ENDS: Readonly<Record<StageCommand, string>> = {
	[KICKOFF]: 'plan posted',
	[HALFRUN]: 'gated, before the commit',
	[PRRUN]: 'green, mergeable PR',
	[FULLRUN]: 'merged',
}

const NEXT_PREFIX = 'Next: '
const NEXT_SEPARATOR = ' | '
const STATE_HEADER = 'Issue state'
const CELL_ARROW = ' → '
const REACHED_CELL = 'reached — report and stop'

interface StageFacts {
	is_closed: boolean
	is_prrun_stopped: boolean
	is_halfrun_stopped: boolean
	is_planned: boolean
}

interface StageDecision {
	state: StageState
	command: StageCommand
	// The first piece of work the run does, or `reached` when there is none left for this command.
	start: string
	end: string
	is_reached: boolean
}

function to_command(value: string | undefined): StageCommand | undefined {
	return COMMANDS.find((command) => command === value)
}

// The furthest rung the facts show, so a closed issue is merged whatever its hold still says.
function state_of(facts: StageFacts): StageState {
	if (facts.is_closed) return MERGED
	if (facts.is_prrun_stopped) return PRRUN_STOPPED
	if (facts.is_halfrun_stopped) return HALFRUN_STOPPED

	return facts.is_planned ? PLANNED : FRESH
}

function decide(state: StageState, command: StageCommand): StageDecision {
	const is_reached = STATES.indexOf(state) > COMMANDS.indexOf(command)
	const start = is_reached ? REACHED : STARTS[state]

	return { state, command, start, end: ENDS[command], is_reached }
}

// The commands that go further than `command`, nearest first — what a stop offers next.
function next_commands(command: StageCommand): ReadonlyArray<StageCommand> {
	return COMMANDS.slice(COMMANDS.indexOf(command) + 1)
}

// The `Next:` line a stop's Telegram and report carry, e.g. `Next: prrun #<N> | fullrun #<N>`.
function next_line(command: StageCommand, issue: string): string {
	const commands = next_commands(command).map((next) => `${next} ${issue_cite.plain(issue)}`)

	return `${NEXT_PREFIX}${commands.join(NEXT_SEPARATOR)}`
}

function format_decision(issue: string, decision: StageDecision): string {
	const fields = [`at: ${decision.state}`, `to: ${decision.command}`, `start: ${decision.start}`]

	return `stage ${issue_cite.plain(issue)} — ${fields.join(' · ')}`
}

function cell(state: StageState, command: StageCommand): string {
	const decision = decide(state, command)

	return decision.is_reached ? REACHED_CELL : `${decision.start}${CELL_ARROW}${decision.end}`
}

// The stage table as rows of cells, header first — the shape both documents carry.
function table_rows(): ReadonlyArray<ReadonlyArray<string>> {
	const header = [STATE_HEADER, ...COMMANDS.map((command) => `\`${command}\``)]
	const rows = STATES.map((state) => [
		`\`${state}\``,
		...COMMANDS.map((command) => cell(state, command)),
	])

	return [header, ...rows]
}

const run_stage = {
	COMMANDS,
	DEFAULT_COMMAND,
	FRESH,
	HALFRUN,
	HALFRUN_STOPPED,
	KICKOFF,
	MERGED,
	PLANNED,
	PRRUN,
	PRRUN_STOPPED,
	REACHED,
	START_TOKENS,
	STATES,
	decide,
	format_decision,
	next_commands,
	next_line,
	state_of,
	table_rows,
	to_command,
} as const

export type { StageCommand, StageDecision, StageFacts, StageState }
export { run_stage }
