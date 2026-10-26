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
// another long command is refused. A foreground `ship` without the cap is given it the same way.
//
// **Its stop-time half reads the same fact from the other side.** A backgrounded task the transcript
// launched but never saw finish is still running, and in a child the stop about to happen kills it —
// so the `Stop` hook sends the child back to wait or detach rather than asking for a notify
// (`stop-rules.ts`). The launch and finish ids are `time_transcript_line`'s, never re-parsed here.

// The josh subcommands that run long enough to be backgrounded, as `time_shell` names them — canonical,
// so the `ga` / `g` / `fu` aliases are covered by the one spelling.
// `ship`, `ship:wait` and `lane:plan` are run in the foreground at the cap rather than refused: a
// `ship:wait` left at the two-minute default is moved aside mid-chunk and dies with the turn, its verdict
// unread, and a cut `lane:plan` leaves its plan recorded with the check it gates unanswered.
const FOREGROUND_COMMANDS: ReadonlySet<string> = new Set(
	['ship', 'ship:wait', 'lane:plan'].map((name) => `${time_shell.JOSH_PREFIX}${name}`),
)
const LONG_RUNNING_COMMANDS: ReadonlySet<string> = new Set([
	...['gate', 'git', 'followup'].map((name) => `${time_shell.JOSH_PREFIX}${name}`),
	...FOREGROUND_COMMANDS,
])

const BACKGROUND_KEY = 'run_in_background'
const TIMEOUT_KEY = 'timeout'
// The longest a foreground Bash call may run. A `ship` rarely carries a `timeout`, and a backgrounded one
// that does may exceed the foreground cap, so the rewrite sets it: left at the two-minute default, a
// preflight whose scoped pair outruns it is cut before `launched` (#3027) or moved to the background and
// killed with the turn (#4101).
const FOREGROUND_TIMEOUT_MS = 600_000

function is_backgrounded(input: unknown): boolean {
	return json_value.is_record(input) && input[BACKGROUND_KEY] === true
}

function long_commands_of(command: string): Array<string> {
	return time_shell.josh_commands_of(command).filter((name) => LONG_RUNNING_COMMANDS.has(name))
}

// A call whose long-running work is `ship` or `ship:wait` alone. In a child a foreground `ship` already
// detaches itself after its preflight (`run-ship-cli.ts` → `should_detach`), so the only fault in
// backgrounding it is the flag — and the flag is what the hook rewrites.
function ships_alone(command: string): boolean {
	const names = long_commands_of(command)

	return names.length > 0 && names.every((name) => FOREGROUND_COMMANDS.has(name))
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

// The input of a Bash call whose long-running work is `ship` alone, or `undefined` for any other call.
function ship_alone_input(call: GuardedCall): Record<string, unknown> | undefined {
	if (call.name !== cost_blocks.BASH_TOOL || !json_value.is_record(call.input)) return undefined

	return ships_alone(time_shell.bash_command(call.input)) ? call.input : undefined
}

// A foreground call that already carries the foreground cap, which the harness never moves aside.
function is_capped_foreground(input: Record<string, unknown>): boolean {
	const timeout = input[TIMEOUT_KEY]

	return !is_backgrounded(input) && typeof timeout === 'number' && timeout >= FOREGROUND_TIMEOUT_MS
}

// **A `ship` in a child is run in the foreground at the cap, not refused**. The refusal of a
// backgrounded one asked for nothing but the same call in the foreground — 14 of 41 lane `ship`
// refusals in one measured backlogrun were that round trip, paid at the run's largest context.
//
// A foreground one at the two-minute default is moved aside once its preflight outruns it, and dies
// the same way (joshuafolkken/kit#4101). The input with the flag cleared and the cap set, or
// `undefined` for every call this does not apply to.
function foreground_input(
	call: GuardedCall,
	is_lane_child: () => boolean = () => lane_child_marker.is_child_of(process.cwd()),
): Record<string, unknown> | undefined {
	const input = ship_alone_input(call)

	if (input === undefined || is_capped_foreground(input) || !is_lane_child()) return undefined

	return { ...input, [BACKGROUND_KEY]: false, [TIMEOUT_KEY]: FOREGROUND_TIMEOUT_MS }
}

const FOREGROUND_NOTE =
	"lane background: a lane child's `josh ship`, `josh ship:wait` or `josh lane:plan` backgrounded, by its flag or by " +
	'outrunning the Bash timeout, dies with the headless turn — so it was run in the foreground at the ' +
	'600000 ms cap, where `ship` detaches itself after the preflight. Then follow ' +
	'`chain-rule.md` step 0 (`josh ship:wait` on `launched`).'

type LaunchedIds = (block: TranscriptBlock) => ReadonlyArray<string>

// One line's word on each id: a launch opens it, a finish notice closes it.
function apply_line(open: Set<string>, line: string, launched_ids: LaunchedIds): void {
	const parsed = time_transcript_line.parse_line(line)

	if (parsed === undefined) return

	const launched = parsed.blocks.flatMap((block) => launched_ids(block))

	for (const id of launched) open.add(id)
	open.delete(parsed.finished_background)
}

// The launches `launched_ids` reads off the transcript tail that never saw their finish. A launch is
// read off its own tool result and a finish off the harness notice or a `TaskStop` result, both by
// `time_transcript_line`.
//
// **Read in order, so the later word on an id wins.** A subagent resumed by `SendMessage` runs again
// under the id its first run's notice already named; a set of every finish ever seen would read the
// resumed run as finished (joshuafolkken/kit#4347).
function unfinished_ids(tail: string, launched_ids: LaunchedIds): ReadonlyArray<string> {
	const open = new Set<string>()

	for (const line of tail.split('\n')) apply_line(open, line, launched_ids)
	open.delete('')

	return [...open]
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

// The backgrounded commands alone — what tells a stop with only subagents left apart from one a
// command still holds.
function pending_command_ids(tail: string): ReadonlyArray<string> {
	return unfinished_ids(tail, (block) => [block.background_id])
}

const LANE_BACKGROUND_REASON =
	'⛔ lane background: this session is a dispatched lane child (`JOSH_LANE_CHILD`), a headless ' +
	'process whose background tasks die when the turn ends. Hand over to ' +
	'`pnpm josh ship --detach --review "<title> #<N>"`, issued in the foreground, then `josh ship:wait <N>` on ' +
	'`launched` or end the turn. It fires on every occurrence ' +
	'(`.claude/skills/workflow-commands/chain-rule.md` step 0).'

const LANE_BACKGROUND_STOP_REASON =
	'⛔ lane background stop: this is a dispatched lane child (`JOSH_LANE_CHILD`) and a background task ' +
	'it launched has not finished, and ending this turn kills it. Wait for it in the foreground, or ' +
	're-issue the work through `pnpm josh ship --detach` — do not notify, stop or repeat your reply.'

// **Only subagents left: the wait that receives their answer** (joshuafolkken/kit#4803). Their completion
// notice is delivered only when a tool call ends, so one long hand-written loop holds it back until the
// loop itself gives up; short foreground calls, one at a time, let it in at the first one to end.
const LANE_AGENT_STOP_REASON =
	'⛔ lane agent stop: this is a dispatched lane child (`JOSH_LANE_CHILD`) and a subagent it launched ' +
	'has not finished; ending this turn kills it. Its completion notice arrives only when a tool call ' +
	'ends: wait with one short foreground call at a time (`sleep 20`) until it arrives — never a loop ' +
	'over its `.output`. Do not notify, stop or repeat your reply.'

// The row itself, so `delivered-rules.ts` spreads one entry. It fires on every occurrence (`decide`
// returns true): a child must never background these, so the route is always the detached ship, never
// a reissue. It declares no `keeps`: the detached ship is a different command, not this call made right.
const ROW = {
	id: 'lane-background',
	is_trigger: (call: GuardedCall): boolean => is_background_long_run(call),
	reason: LANE_BACKGROUND_REASON,
	decide: (): boolean => true,
	// `pretool-guard.ts` rewrites a lone `josh ship` to the foreground rather than refusing it; this is
	// the note it attaches, so `rule-value.ts` counts that rewrite as this row's delivery.
	rewrite_note: FOREGROUND_NOTE,
	// The Stop hook delivers the same rule at the turn's end, for the background task or subagent the
	// turn would kill.
	stop_reasons: [LANE_BACKGROUND_STOP_REASON, LANE_AGENT_STOP_REASON],
	about: {
		title: 'Lane child background push',
		topic: '`.claude/skills/workflow-commands/background-commands.md`',
		fires:
			'a dispatched lane child backgrounding `josh gate` / `git` / `followup` / `ship`; it hands over `pnpm josh ship --detach`; the Stop hook also blocks ending a turn with its background task or subagent unfinished. Every occurrence',
		quiet: 'not a lane child, or the foreground `ship --detach`',
	},
}

const lane_background = {
	FOREGROUND_NOTE,
	LANE_AGENT_STOP_REASON,
	LANE_BACKGROUND_REASON,
	LANE_BACKGROUND_STOP_REASON,
	ROW,
	foreground_input,
	is_background_long_run,
	pending_agent_ids,
	pending_background_ids,
	pending_command_ids,
}

export { lane_background }
