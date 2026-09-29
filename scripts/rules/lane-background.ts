import { cost_blocks } from '#scripts/cost-runtime/cost-blocks'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { time_shell } from '#scripts/time-runtime/time-shell'
import { time_transcript_line } from '#scripts/time-runtime/time-transcript-line'
import { run_tail } from './run-tail'

// A dispatched lane child is stopped from backgrounding a long-running josh command (joshuafolkken/kit#2704).
//
// **A headless child's turn-end is its process's end.** A lane child runs as `claude -p`, and there the
// background Bash tasks die with the turn — so "a background command's exit re-invokes the session"
// (`background-commands.md`) does not hold. joshuafolkken/kit#2457 refused a non-detached `josh ship`
// for exactly that reason, but only `ship`: the #2606 child backgrounded `pnpm josh gate && pnpm josh git
// -y …` directly, ended its turn, and the gate died at `exit code 143` with the implementation, the
// scoped checks, a review round and the live verification all done — parked instead of merged.
//
// **So the refusal is put at the launch, and it names the detached route.** The region from the gate to
// the merge belongs to `pnpm josh ship --detach` in a child (`chain-rule.md` step 0), whose supervisor
// outlives the turn. `ship` itself is not in the set: #2457 already detaches it implicitly in a child.
//
// **Its stop-time half reads the same fact from the other side.** A backgrounded task the transcript
// launched but never saw finish is still running, and in a child the stop about to happen kills it —
// so the `Stop` hook sends the child back to wait or detach rather than asking for a notify
// (`stop-rules.ts`). The launch and finish ids are `time_transcript_line`'s, never re-parsed here.

// The josh subcommands that run long enough to be backgrounded, as `time_shell` names them — canonical,
// so the `ga` / `g` / `fu` aliases are covered by the one spelling.
const LONG_RUNNING_COMMANDS: ReadonlySet<string> = new Set(
	['gate', 'git', 'followup'].map((name) => `${time_shell.JOSH_PREFIX}${name}`),
)

const BACKGROUND_KEY = 'run_in_background'

function is_backgrounded(input: unknown): boolean {
	return json_value.is_record(input) && input[BACKGROUND_KEY] === true
}

function runs_long_command(command: string): boolean {
	return time_shell.josh_commands_of(command).some((name) => LONG_RUNNING_COMMANDS.has(name))
}

// The call's own fields alone: a backgrounded Bash call that runs a long josh command, or the push step
// in either spelling. A child's foreground push is claimed too, because `run-tail` would otherwise answer
// it with "reissue it backgrounded" — the one reissue this row then refuses — so the child is handed the
// detached route on its first refusal rather than two contradictory ones.
function is_candidate(call: GuardedCall): boolean {
	if (run_tail.is_push_step_call(call)) return true
	if (call.name !== cost_blocks.BASH_TOOL || !is_backgrounded(call.input)) return false

	return runs_long_command(time_shell.bash_command(call.input))
}

// True when this session is a dispatched lane child backgrounding a long-running josh command. The call's
// own fields are tested first, so the dispatch mark is read only on the handful of calls that match.
function is_background_long_run(
	call: GuardedCall,
	is_lane_child: () => boolean = () => lane_child_marker.is_child_of(process.cwd()),
): boolean {
	return is_candidate(call) && is_lane_child()
}

// The background tasks the transcript tail launched and never saw finish. A launch is read off its own
// tool result and a finish off the harness notice, both by `time_transcript_line`.
function pending_background_ids(tail: string): ReadonlyArray<string> {
	const lines = tail.split('\n').map((line) => time_transcript_line.parse_line(line))
	const finished = new Set(lines.map((line) => line?.finished_background ?? ''))
	const launched = lines.flatMap((line) => line?.blocks.map((block) => block.background_id) ?? [])

	return launched.filter((id) => id !== '' && !finished.has(id))
}

const LANE_BACKGROUND_REASON =
	'⛔ lane background: this session is a dispatched lane child (`JOSH_LANE_CHILD`), a headless ' +
	'`claude -p` process whose background Bash tasks are killed when the turn ends — so a backgrounded ' +
	'`josh gate` / `josh git` / `josh followup` never re-invokes you; it dies at `exit code 143` ' +
	'(joshuafolkken/kit#2704, measured on the #2606 child: implementation, review and live verification ' +
	'done, the run parked instead of merged). Hand the gate-to-merge region to the detached supervisor ' +
	'instead: `pnpm josh ship --detach --review "<title> #<N>"` (add `--cite <N>`), then end the turn on ' +
	'`launched` / `busy` — `.claude/skills/workflow-commands/chain-rule.md` step 0 is the single source. A ' +
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
	LANE_BACKGROUND_REASON,
	LANE_BACKGROUND_STOP_REASON,
	ROW,
	is_background_long_run,
	pending_background_ids,
}

export { lane_background }
