import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { time_shell } from '#scripts/time-runtime/time-shell'
import {
	time_transcript_line,
	type Block as TranscriptBlock,
} from '#scripts/time-runtime/time-transcript-line'
import { run_tail_rule } from './run-tail-rule'

// A dispatched lane child is stopped from backgrounding a long-running josh command.
//
// **A headless child's turn-end is its process's end.** A lane child runs as `claude -p`, and there the
// background Bash tasks die with the turn — so "a background command's exit re-invokes the session"
// (`background-commands.md`) does not hold. A child that backgrounds `pnpm josh gate && pnpm josh git
// -y …` and ends its turn sees the gate die at `exit code 143` with the implementation, the scoped
// checks, a review round and the live verification all done — parked instead of merged.
//
// **So the refusal is put at the launch, and it names the detached route.** The region from the gate to
// the merge belongs to `pnpm josh ship --detach` in a child (`chain-rule.md` step 0), whose supervisor
// outlives the turn.
//
// **`ship` is in the set too, `--detach` or not**. It detaches in a child, but only after its
// preflight — the scoped checks — has passed in the calling process, so a backgrounded `ship` is
// killed at the turn's end before any supervisor exists. Issued in the foreground it returns at
// `launched` within the tool timeout, and the supervisor carries the rest. A backgrounded `ship` alone
// is not refused but rewritten into that foreground call (`foreground_input`); one chained after
// another long command is refused.
//
// **Its stop-time half reads the same fact from the other side.** A backgrounded task the transcript
// launched but never saw finish is still running, and in a child the stop about to happen kills it —
// so the `Stop` hook sends the child back to wait or detach rather than asking for a notify
// (`stop-rules.ts`). The launch and finish ids are `time_transcript_line`'s, never re-parsed here.

// The josh subcommands that run long enough to be backgrounded, as `time_shell` names them — canonical,
// so the `ga` / `g` / `fu` aliases are covered by the one spelling.
const SHIP_COMMAND = `${time_shell.JOSH_PREFIX}ship`
const LONG_RUNNING_COMMANDS: ReadonlySet<string> = new Set([
	...['gate', 'git', 'followup'].map((name) => `${time_shell.JOSH_PREFIX}${name}`),
	SHIP_COMMAND,
])

const BACKGROUND_KEY = 'run_in_background'
const TIMEOUT_KEY = 'timeout'
// The longest a foreground Bash call may run. A backgrounded call rarely carries a `timeout`, and one that
// does may exceed the foreground cap, so the rewrite sets it: left at the two-minute default, a preflight
// whose scoped pair outruns it is cut before `launched`, the #3027 failure the rewrite exists to avoid.
const FOREGROUND_TIMEOUT_MS = 600_000

function is_backgrounded(input: unknown): boolean {
	return json_value.is_record(input) && input[BACKGROUND_KEY] === true
}

function long_commands_of(command: string): Array<string> {
	return time_shell.josh_commands_of(command).filter((name) => LONG_RUNNING_COMMANDS.has(name))
}

// A call whose long-running work is `ship` alone. In a child a foreground `ship` already detaches
// itself after its preflight (`run-ship-cli.ts` → `should_detach`), so the only fault in backgrounding
// it is the flag — and the flag is what the hook rewrites.
function ships_alone(command: string): boolean {
	const names = long_commands_of(command)

	return names.length > 0 && names.every((name) => name === SHIP_COMMAND)
}

function backgrounded_bash_command(call: GuardedCall): string | undefined {
	if (call.name !== cost_blocks.BASH_TOOL || !is_backgrounded(call.input)) return undefined

	return time_shell.bash_command(call.input)
}

function is_backgrounded_ship(call: GuardedCall): boolean {
	const command = backgrounded_bash_command(call)

	return command !== undefined && ships_alone(command)
}

// The call's own fields alone: a backgrounded Bash call that runs a long josh command, or the push step
// in either spelling. A child's foreground push is claimed too, because `run-tail` would otherwise answer
// it with "reissue it backgrounded" — the one reissue this row then refuses — so the child is handed the
// detached route on its first refusal rather than two contradictory ones. A backgrounded `ship` alone is
// not refused: `foreground_input` turns it into the foreground call the refusal used to ask for.
function is_candidate(call: GuardedCall): boolean {
	if (run_tail_rule.is_push_step_call(call)) return true

	const command = backgrounded_bash_command(call)

	if (command === undefined || is_backgrounded_ship(call)) return false

	return long_commands_of(command).length > 0
}

// True when this session is a dispatched lane child backgrounding a long-running josh command. The call's
// own fields are tested first, so the dispatch mark is read only on the handful of calls that match.
function is_background_long_run(
	call: GuardedCall,
	is_lane_child: () => boolean = () => lane_child_marker.is_child_of(process.cwd()),
): boolean {
	return is_candidate(call) && is_lane_child()
}

// **A backgrounded `ship` in a child is rewritten, not refused**. The refusal
// asked for nothing but the same call in the foreground — 14 of 41 lane `ship` refusals in one measured
// backlogrun were that round trip, paid at the run's largest context. The input with the flag cleared,
// or `undefined` for every call this does not apply to.
function foreground_input(
	call: GuardedCall,
	is_lane_child: () => boolean = () => lane_child_marker.is_child_of(process.cwd()),
): Record<string, unknown> | undefined {
	if (!is_backgrounded_ship(call) || !json_value.is_record(call.input)) return undefined

	if (!is_lane_child()) return undefined

	return { ...call.input, [BACKGROUND_KEY]: false, [TIMEOUT_KEY]: FOREGROUND_TIMEOUT_MS }
}

const FOREGROUND_NOTE =
	'lane background: this lane child backgrounded `josh ship`, which would die with the headless turn ' +
	'before its supervisor exists — so it was run in the foreground instead, where it detaches itself ' +
	'after the preflight. End the turn on `launched` / `busy` (joshuafolkken/kit#3154).'

// The launches `launched_ids` reads off the transcript tail that never saw their finish. A launch is
// read off its own tool result and a finish off the harness notice, both by `time_transcript_line`.
function unfinished_ids(
	tail: string,
	launched_ids: (block: TranscriptBlock) => ReadonlyArray<string>,
): ReadonlyArray<string> {
	const lines = tail.split('\n').map((line) => time_transcript_line.parse_line(line))
	const finished = new Set(lines.map((line) => line?.finished_background ?? ''))
	const blocks = lines.flatMap((line) => line?.blocks ?? [])
	const launched = blocks.flatMap((block) => launched_ids(block))

	return launched.filter((id) => id !== '' && !finished.has(id))
}

// The background tasks the tail launched and never saw finish — commands and subagents alike,
// since a lane child's turn-end kills either.
function pending_background_ids(tail: string): ReadonlyArray<string> {
	return unfinished_ids(tail, (block) => [block.background_id, block.agent_id])
}

// The backgrounded subagents alone. A subagent always ends and its notice re-invokes the session; a
// command may be a server that never exits, so only this set says the run is certain to resume.
function pending_agent_ids(tail: string): ReadonlyArray<string> {
	return unfinished_ids(tail, (block) => [block.agent_id])
}

const LANE_BACKGROUND_REASON =
	'⛔ lane background: this session is a dispatched lane child (`JOSH_LANE_CHILD`), a headless ' +
	'`claude -p` process whose background Bash tasks are killed when the turn ends — so a backgrounded ' +
	'`josh gate` / `josh git` / `josh followup` / `josh ship` never re-invokes you; it dies at `exit code ' +
	'143` (joshuafolkken/kit#2704, measured on the #2606 child: implementation, review and live ' +
	'verification done, the run parked instead of merged). Hand the gate-to-merge region to the detached ' +
	'supervisor instead: `pnpm josh ship --detach --review "<title> #<N>"` (add `--cite <N>`) issued in ' +
	'the foreground — its preflight runs in this process before the supervisor exists, so a backgrounded ' +
	'`ship` dies with the turn (joshuafolkken/kit#3027; a backgrounded `ship` issued alone is moved to ' +
	'the foreground for you, joshuafolkken/kit#3154) — then end the turn on `launched` / `busy`. ' +
	'`.claude/skills/workflow-commands/chain-rule.md` step 0 is the single source. A ' +
	'single check you must read before continuing runs in the foreground within the tool timeout; the ' +
	'commit-push step does not — in a child it too belongs to the detached ship, in either spelling. This ' +
	'rule fires on every occurrence, not once per run.'

const LANE_BACKGROUND_STOP_REASON =
	'⛔ lane background stop: this is a dispatched lane child (`JOSH_LANE_CHILD`) and a background task ' +
	'it launched has not finished — ending this headless turn kills it, and nothing re-invokes you ' +
	'afterwards (joshuafolkken/kit#2704). Do not send a notification and do not stop: wait for the task ' +
	'in the foreground and act on its result, or re-issue the work through `pnpm josh ship --detach`, ' +
	'whose supervisor outlives the turn (`.claude/skills/workflow-commands/chain-rule.md` step 0). Do ' +
	'not repeat your previous reply.'

// The row itself, so `delivered-rules.ts` spreads one entry. It fires on every occurrence (`decide`
// returns true): a child must never background these, so the route is always the detached ship, never
// a reissue. It declares no `keeps`: the detached ship is a different command, not this call made right.
const ROW = {
	id: 'lane-background',
	is_trigger: (call: GuardedCall): boolean => is_background_long_run(call),
	reason: LANE_BACKGROUND_REASON,
	decide: (): boolean => true,
}

const lane_background = {
	FOREGROUND_NOTE,
	LANE_BACKGROUND_REASON,
	LANE_BACKGROUND_STOP_REASON,
	ROW,
	foreground_input,
	is_background_long_run,
	pending_agent_ids,
	pending_background_ids,
}

export { lane_background }
