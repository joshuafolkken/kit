import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import { time_josh_names } from '#scripts/time-runtime/time-josh-names'
import { time_shell } from '#scripts/time-runtime/time-shell'
import type { Block, TranscriptLine } from '#scripts/time-runtime/time-transcript-line'
import { guard_friction } from '#tools/retrospective/guard-friction'
import { cost_audit_command } from './cost-audit-command'

// The Bash command runs and refusal retries `josh cost:audit` counts (joshuafolkken/kit#7138).
//
// **A run is the leading tokens of consecutive Bash calls in one session** — a josh call as its
// subcommand (`josh gate`), any other as its `cost-audit-command.ts` key (`git status`) — taken two and
// three at a time. Each transcript is walked on its own, a subagent's apart from its parent, so a run
// never spans two sessions. A run repeated across sessions is a candidate for one command.
//
// **A retry is a Bash call issued after a refusal's result came back, within the next two calls, with
// the refused call's token.** It is tallied under the guard name the By guard table uses
// (`guard_friction.guard_name`), so the two sections name one guard the same way.

const SHORTEST_RUN = 2
const LONGEST_RUN = 3
const RUN_LENGTHS = [SHORTEST_RUN, LONGEST_RUN]
const TOP_RUNS = 10
const RETRY_REACH = 2
const RUN_SEPARATOR = ' → '

// What the walk reads of a session: its transcript lines alone.
interface LinedSession {
	lines: ReadonlyArray<TranscriptLine>
}

interface CountRow {
	key: string
	count: number
}

interface Sequences {
	runs: ReadonlyArray<CountRow>
	retries: ReadonlyArray<CountRow>
}

interface PendingRetry {
	guard: string
	token: string
	left: number
}

interface RetryState {
	tokens: Map<string, string>
	pending: Array<PendingRetry>
	retries: Array<string>
}

function token_of(input: unknown): string {
	const command = time_shell.bash_command(input)

	return time_josh_names.josh_command_of(command) || cost_audit_command.command_key(command)
}

function bash_tokens(lines: ReadonlyArray<TranscriptLine>): Array<string> {
	return lines
		.flatMap((line) => line.blocks)
		.filter((block) => block.type === 'tool_use' && block.name === cost_blocks.BASH_TOOL)
		.map((block) => token_of(block.input))
		.filter((token) => token !== '')
}

function runs_of(tokens: ReadonlyArray<string>, length: number): Array<string> {
	return tokens
		.slice(0, Math.max(tokens.length - length + 1, 0))
		.map((_, start) => tokens.slice(start, start + length).join(RUN_SEPARATOR))
}

function session_runs(lines: ReadonlyArray<TranscriptLine>): Array<string> {
	const tokens = bash_tokens(lines)

	return RUN_LENGTHS.flatMap((length) => runs_of(tokens, length))
}

// Each key with how often it occurs, the most frequent first; a tie keeps first-seen order.
function count_rows(keys: ReadonlyArray<string>): Array<CountRow> {
	const counts = new Map<string, number>()

	for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1)

	return [...counts]
		.map(([key, count]) => ({ key, count }))
		.toSorted((left, right) => right.count - left.count)
}

// A call settles every pending refusal of its token as a retry and uses one call of the others' reach.
function on_use(state: RetryState, block: Block): void {
	const token = block.name === cost_blocks.BASH_TOOL ? token_of(block.input) : ''
	const matched = state.pending.filter((pending) => pending.token === token)

	state.tokens.set(block.id, token)
	state.retries.push(...matched.map((pending) => pending.guard))
	state.pending = state.pending
		.filter((pending) => pending.token !== token && pending.left > 1)
		.map((pending) => ({ ...pending, left: pending.left - 1 }))
}

function on_result(state: RetryState, block: Block): void {
	const token = state.tokens.get(block.result_id) ?? ''

	if (token === '' || block.refusal_guard === '') return

	const guard = guard_friction.guard_name(block.refusal_guard)

	state.pending.push({ guard, token, left: RETRY_REACH })
}

function on_block(state: RetryState, block: Block): void {
	if (block.type === 'tool_use') on_use(state, block)
	else if (block.result_id !== '') on_result(state, block)
}

function session_retries(lines: ReadonlyArray<TranscriptLine>): Array<string> {
	const state: RetryState = { tokens: new Map(), pending: [], retries: [] }
	const blocks = lines.flatMap((line) => line.blocks)

	for (const block of blocks) on_block(state, block)

	return state.retries
}

// The sessions' runs, the `TOP_RUNS` most frequent, and their retries by guard.
function sequences_of(sessions: ReadonlyArray<LinedSession>): Sequences {
	const runs = sessions.flatMap((session) => session_runs(session.lines))

	return {
		runs: count_rows(runs).slice(0, TOP_RUNS),
		retries: count_rows(sessions.flatMap((session) => session_retries(session.lines))),
	}
}

function count_lines(title: string, rows: ReadonlyArray<CountRow>): Array<string> {
	const body =
		rows.length === 0 ? ['  none'] : rows.map((row) => `  ${row.key}: ${String(row.count)}`)

	return ['', title, ...body]
}

function sequence_lines(sequences: Sequences): Array<string> {
	return [
		...count_lines('Bash command runs (2 and 3 consecutive calls)', sequences.runs),
		...count_lines(
			`Retries after a refusal (same command within ${String(RETRY_REACH)} calls), by guard`,
			sequences.retries,
		),
	]
}

const cost_audit_sequence = { sequences_of, sequence_lines }

export type { CountRow, Sequences }
export { cost_audit_sequence }
