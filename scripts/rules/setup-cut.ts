import { lane_child_marker, type MarkerSource } from '#scripts/lane/lane-child-marker'
import { lane_paths } from '#scripts/lane/lane-paths'
import { run_cut } from '#scripts/run/run-cut'
import { run_event_stream } from '#scripts/run/run-event-stream'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { bash_triggers } from './bash-triggers'
import { implementation_cut } from './implementation-cut'
import { shell_segments } from './shell-segments'

// The setup-phase cut, delivered at the call it binds on (joshuafolkken/kit#2346).
//
// **The earliest boundary, and the one prose could never hold.** joshuafolkken/kit#1864 and
// joshuafolkken/kit#2310 each measured a cut carried as prose firing 0 times until a `PreToolUse`
// refusal took it. The setup cut is one boundary earlier than both: a dispatched lane child, by the
// time it has posted its plan, has read the skill, the manual documents and the issue — ~130,000 tokens
// that every later request re-reads — and its first implementation edit is the moment that context
// stops being useful and starts being re-billed. This refuses that edit until the cut is taken.
//
// **The occasion is the run's own event stream, not the cut record.** The setup cut resumes back into
// implementation and clears its record on resume (`run-cut-cli.ts`), so the record cannot say "setup is
// done" the way the pre-gate cut's persisting record does. The stream can: the plan-posting step
// appends a `plan` event, and `run:cut` appends a `cut` event, so the newest event is `plan` for exactly
// the window between setup finishing and the cut being taken — which is the window this guard fires in.
const CUT_COMMANDS: ReadonlySet<string> = new Set(['run:cut'])
const SETUP_FLAG = /(?:^|\s)--setup(?:[=\s]|$)/u

function is_setup_cut_segment(segment: string): boolean {
	return shell_segments.is_josh_command(segment, CUT_COMMANDS) && SETUP_FLAG.test(segment)
}

// Whether this command takes the setup-phase cut, segment-wise so a spelling quoted inside a body is not
// read as the call, and alias-expanded so `pnpm josh rct --setup` is the same call.
function takes_the_setup_cut(command: string): boolean {
	return shell_segments.segments_of(command).some((segment) => is_setup_cut_segment(segment))
}

// What the trigger has to know about the world, passed in so the decision is testable without a lane on
// disk or an event stream. `last_event` is the newest kind on the run's stream, read lazily so it is
// priced only after the tool-name and lane checks pass — off the handful of edits a dispatched child
// makes, never every call in the run.
interface LaneSetupState {
	directory: string
	source: MarkerSource
	last_event: () => string | undefined
}

// The newest event on the run's stream, read synchronously from the common git directory the stream is
// keyed on (`run-event-stream-emit.ts`), so a `PreToolUse` hook — which answers synchronously or not at
// all — can read it. A checkout git cannot describe, or a stream that will not read, comes back
// `undefined`, which the trigger treats as "not the setup window" rather than firing on a fault.
function last_stream_event(): string | undefined {
	const common = run_cut.common_git_directory_sync()

	if (common === undefined) return undefined

	return run_event_stream.read_last(run_event_stream.target_of(common))?.kind
}

function current_state(): LaneSetupState {
	return {
		directory: process.cwd(),
		source: process.env,
		last_event: last_stream_event,
	}
}

// A dispatched lane child for this checkout, read from the dispatch mark against this lane's own issue
// so a leaked mark for another issue reads as a person (joshuafolkken/kit#1904). Unlike the other two
// cut guards there is no carried-cut check: the setup cut's record is cleared on resume, so the run's
// event stream — not the record — is what tells a resumed process apart from a fresh one.
function lane_child_issue(state: LaneSetupState): string | undefined {
	if (!lane_child_marker.is_child_of(state.directory, state.source)) return undefined

	return lane_paths.lane_issue_of(state.directory, { ...state.source })
}

// **The tool-name test comes first, the lane second, the stream last.** This predicate is asked of every
// call in the run, so the `Edit` / `Write` string match keeps the lane read off all but the edits, and
// the lane read keeps the git-and-stream read off every edit but those a dispatched child makes — where
// a stream whose newest event is `plan` is exactly the setup-then-implement boundary this guard catches.
function is_uncut_setup_edit(call: GuardedCall, state: LaneSetupState = current_state()): boolean {
	if (!implementation_cut.is_edit_tool(call.name) || lane_child_issue(state) === undefined) {
		return false
	}

	return state.last_event() === run_event_stream.EVENT_KIND.PLAN
}

// The instruction in the shape a refusal can carry: what the cut is for, what each verdict means, and
// the reissue sentence every delivery needs. The verdicts are spelled out rather than pointed at,
// because `cut` is the only one that ends the turn — the same reason `pre-gate-cut.ts` spells them out.
const SETUP_CUT_REASON =
	'⛔ setup-phase cut: this checkout is a lane dispatched for this issue and its plan has been posted, ' +
	'so setup is done — the skill, the manual documents and the issue body it read (~130,000 tokens) are ' +
	'now re-read on every later request. Take the cut before this first implementation edit. ' +
	'`pnpm josh run:cut <N> --setup` ends this process and relaunches a fresh one that resumes into ' +
	'implementation (`resume-impl`), dropping the setup context rather than carrying it — ' +
	'joshuafolkken/kit#2346 built the boundary and put its position in the run driver (`run:step`). Issue ' +
	'`pnpm josh run:cut <N> --setup` now and read the verdict: on `cut`, **end the turn immediately** — ' +
	'the fresh process owns the run and continues into implementation, so it must not be waited for; on ' +
	'`not-a-lane`, `unready`, `busy`, `failed` or `unknown`, this process carries the run on and the edit ' +
	'is simply the next call. Never relaunch a second process after `busy`. This fired because the ' +
	'dispatch mark names this lane and the plan event is the newest on the run stream; a person working ' +
	'here carries no mark and sees no refusal, so there is no human-or-child judgement left to make. The ' +
	'procedure is `.claude/skills/workflow-commands/pre-gate-cut.md`. Reissue this edit once the cut has ' +
	'answered — it fires once per run, so it cannot repeat on the call in hand.'

// The row itself, so `delivered-rules.ts` spreads one entry. `keeps` is the setup cut command, read from
// a `Bash` call the same way `implementation-cut`'s is.
const ROW = {
	id: 'setup-cut',
	is_trigger: is_uncut_setup_edit,
	reason: SETUP_CUT_REASON,
	keeps: bash_triggers.on_bash_command(takes_the_setup_cut),
}

const setup_cut = {
	ROW,
	SETUP_CUT_REASON,
	is_uncut_setup_edit,
	lane_child_issue,
	takes_the_setup_cut,
}

export type { LaneSetupState }
export { setup_cut }
