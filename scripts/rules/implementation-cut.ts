import { agent_session_role } from '#scripts/agent/agent-session-role'
import { CONTEXT_CUT_THRESHOLD } from '#scripts/cost-runtime/context-cut-threshold'
import { cost_cli, type CostVerdict } from '#scripts/cost-runtime/cost-cli'
import { cost_format } from '#scripts/cost-runtime/cost-format'
import { cost_verdict } from '#scripts/cost-runtime/cost-verdict'
import type { GuardRun } from '#scripts/josh/hook-decision'
import { lane_child_marker, type MarkerSource } from '#scripts/lane/lane-child-marker'
import { lane_paths } from '#scripts/lane/lane-paths'
import { run_cut, type RunCut } from '#scripts/run/cut/run-cut'
import { run_cut_handoff } from '#scripts/run/cut/run-cut-handoff'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { bash_triggers } from './bash-triggers'
import { implementation_cut_verdict } from './implementation-cut-verdict'
import { shell_segments } from './shell-segments'

// The implementation-phase cut, delivered at the call it binds on.
//
// **The verdict is read at the working-tree boundary, not at the entry.** A lane child ends its
// process *during* implementation once its recent-context cost crosses the shared threshold, and a
// fresh one resumes back into implementation. Read only at session entry, where the context has not
// yet grown, the verdict answers `under` by construction; so the guard reads it at each edit, the
// same way `pre-gate-cut.ts` binds the boundary one step later. `cost_cli.session_verdict` is
// synchronous and is the very verdict `pnpm josh cost --cut` prints, so the guard reads it directly
// rather than approximating it — the same statistic and the same threshold, never a second
// measurement.

// The two edit tools the `PreToolUse` matcher routes here, and the working-tree boundary the cut is
// taken at. A `PreToolUse` refusal fires *before* the edit lands, so the tree is at the consistent
// state the previous edit left it — the "between edit batches, never mid-edit" boundary
// `pre-gate-cut.md` requires, reached without waiting for a check to go green.
const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write'])

function is_edit_tool(name: string): boolean {
	return EDIT_TOOLS.has(name)
}

// The one spelling that takes this cut rather than the pre-gate one: `--impl`. A bare `pnpm josh
// run:cut <N>` is the pre-gate boundary and `--resume` / `--end` / `--json` ask about a cut rather than
// take one, so the compliance test looks for the flag that makes it the implementation-phase cut.
const CUT_COMMANDS: ReadonlySet<string> = new Set(['run:cut'])
const IMPL_FLAG = /(?:^|\s)--impl(?:[=\s]|$)/u

function is_impl_cut_segment(segment: string): boolean {
	return shell_segments.is_josh_command(segment, CUT_COMMANDS) && IMPL_FLAG.test(segment)
}

// Whether this command takes the implementation-phase cut, segment-wise so a spelling quoted inside a
// body is not read as the call.
function takes_the_impl_cut(command: string): boolean {
	return shell_segments.segments_of(command).some((segment) => is_impl_cut_segment(segment))
}

// What the trigger has to know about the world, passed in so the decision is testable without a lane on
// disk, a cut record, or a session transcript. `verdict` is the synchronous `pnpm josh cost --cut`
// reading — the same per-request billed-input statistic against the same threshold — so the guard
// prices its cut on exactly what the parent hand-off does.
interface LaneCostState {
	directory: string
	source: MarkerSource
	carried: (now?: Date) => RunCut | undefined
	// The issue whose run hold stands over this checkout — how a `fullrun`
	// held outside a lane is told apart from a person's tree.
	held_issue: () => string | undefined
	verdict: () => CostVerdict
}

function current_state(): LaneCostState {
	return {
		directory: process.cwd(),
		source: process.env,
		carried: run_cut.carried_cut_sync,
		held_issue: run_cut.held_issue_sync,
		// **Read through the short reuse window**. The row now fires per
		// threshold crossing rather than once per run, so this predicate is a candidate on every edit;
		// the window collapses one turn's burst of edits to a single whole-transcript price.
		verdict: (): CostVerdict =>
			implementation_cut_verdict.reused_verdict(() => cost_cli.session_verdict()),
	}
}

// A dispatched lane child's issue for this checkout. The dispatch mark is what tells a child apart from
// a person, read from the environment against this lane's own issue so a
// leaked mark for another issue reads as a person.
function lane_child_issue(state: LaneCostState): string | undefined {
	if (!lane_child_marker.is_child_of(state.directory, state.source)) return undefined

	return lane_paths.lane_issue_of(state.directory, { ...state.source })
}

// The issue a run holds this checkout for, read only outside a lane: a lane's hold is its dispatched
// child's, so a person finishing that lane's work carries no mark and still sees no refusal.
function held_run_issue(state: LaneCostState): string | undefined {
	if (lane_paths.lane_issue_of(state.directory, { ...state.source }) !== undefined) return undefined

	return state.held_issue()
}

// **A ship reviewer is not the run, though it carries its mark and its hold**
// (joshuafolkken/kit#3623). The supervisor launches it in the implementing child's own checkout and
// waits on it, so a cut would end the one session whose findings file the supervisor reads and relaunch
// a second child beside the supervisor's repair. `agent_session_role` is what tells the two apart.
function implementing_run_issue(state: LaneCostState): string | undefined {
	if (agent_session_role.is_reviewer(state.source)) return undefined

	return lane_child_issue(state) ?? held_run_issue(state)
}

// The run this checkout's edits belong to, with no cut already carried — a dispatched lane child, or
// **a `fullrun` held in its own checkout**: the cut was lane-only, so a run a
// person started grew without a bound mid-implementation. The run hold naming an issue is what marks
// such a run, and a person's tree holds nothing, so it still sees no refusal. **The carried-cut half
// keeps the guard silent between a cut and its resume**, exactly as `pre-gate-cut.ts`'s does: a record
// naming this issue means a cut is already in flight, and `begin_cut`'s exclusive create would refuse
// a second one anyway.
function uncut_run_issue(state: LaneCostState): string | undefined {
	const issue = implementing_run_issue(state)

	if (issue === undefined) return undefined

	return state.carried()?.issue === issue ? undefined : issue
}

// **An unmeasurable session is cut in a lane and left alone outside one.** A lane child's safety net is
// the pre-gate direction below; a held run outside a lane is a person's own session, so only a measured
// `over` interrupts it — a provider with no transcript would otherwise refuse every edit it makes.
function warrants_the_cut(state: LaneCostState): boolean {
	const verdict = state.verdict()

	if (lane_child_issue(state) === undefined) return verdict === cost_verdict.OVER_VERDICT

	return verdict !== cost_verdict.UNDER_VERDICT
}

// **The tool-name test comes first and the world is consulted second, the cost measurement last.** This
// predicate is asked of every call in the run, so the `Edit` / `Write` string match keeps the lane read
// off all but the edits, and the lane read keeps the transcript-priced verdict off every edit but those
// a dispatched child makes in an uncut lane — where crossing the threshold is exactly the event this
// guard exists to catch.
//
// **The unmeasurable direction matches the pre-gate cut**. A session that
// cannot be priced reads as warranting the cut, the same safety-net direction `pre-gate-cut.ts`'s
// `warrants_the_cut` takes (`verdict !== UNDER_VERDICT`): the two rules read one statistic against one
// threshold, so they must not disagree about whether an unmeasurable session is due a cut.
function is_over_threshold_edit(
	call: GuardedCall,
	state: LaneCostState = current_state(),
): boolean {
	if (!is_edit_tool(call.name) || uncut_run_issue(state) === undefined) return false

	return warrants_the_cut(state)
}

// **The threshold in the refusal text is assembled from the constant, never spelled**.
// A spelled literal is left behind when the shared threshold moves, telling agents the wrong number;
// building it from `CONTEXT_CUT_THRESHOLD` keeps the two from drifting. `cost_format.format_tokens` renders it the way every cost report does.
const THRESHOLD_TEXT = `${cost_format.format_tokens(CONTEXT_CUT_THRESHOLD)}-token`

// The instruction in the shape a refusal can carry: what the cut is for, what each verdict means, and
// the reissue sentence every delivery needs. The verdicts are spelled out rather than pointed at,
// because `cut` is the only one that ends the turn and a run told merely to "take the cut" would have to
// read which of the others leave it implementing — the same reason `pre-gate-cut.ts` spells them out.
const IMPLEMENTATION_CUT_REASON =
	'⛔ implementation-phase cut: this checkout is a lane dispatched for this issue, or a run holds it for ' +
	'this issue (joshuafolkken/kit#2760), and its recent-context ' +
	`cost has crossed the shared ${THRESHOLD_TEXT} threshold mid-implementation, so the thinking accumulated ` +
	'so far is now re-read on every later request. Take the cut before this edit. ' +
	'First write a handoff file with the Write tool — the user’s instruction verbatim, what you have ' +
	'completed, what remains, and what you deliberately did not touch, as ' +
	`${run_cut_handoff.HANDOFF_FORMAT} (Markdown is refused) — and pass it as \`--handoff <path>\`, ` +
	'so the fresh process resumes on the original instruction rather than the working tree alone ' +
	'(joshuafolkken/kit#2354); a resume that finds no instruction is refused `incomplete` rather than ' +
	'continuing blind. ' +
	'`pnpm josh run:cut --impl <N> --handoff <path>` ends this process and relaunches a fresh one that resumes back into ' +
	'implementation (`resume-impl`), dropping the accumulated context rather than carrying it — ' +
	'joshuafolkken/kit#1933 built the boundary and joshuafolkken/kit#2310 measured it firing 0 times ' +
	'because the verdict was only ever read at session entry, where the context has not yet grown. The ' +
	"verdict is `pnpm josh cost --cut`'s exactly — the same per-request billed-input statistic against the " +
	'same threshold, never a second measurement. Issue `pnpm josh run:cut --impl <N> --handoff <path>` now and read the ' +
	'verdict: on `cut`, **end the turn immediately** — in a lane the fresh process owns the run and ' +
	'continues implementing, so it must not be waited for; outside a lane nothing is relaunched, so first ' +
	'send the `confirmation` Telegram naming the resume command `fullrun #<N>` and keep the hold; on `not-a-lane`, `unready`, `busy`, `failed` or ' +
	'`unknown`, this process carries the run on and the edit is simply the next call. Never relaunch a ' +
	'second process after `busy`. This fired because the dispatch mark names this lane or the run hold ' +
	'names this issue; a person working here carries no mark and holds no run, so sees no refusal, so there is no human-or-child judgement left to make. The ' +
	'procedure is `.claude/skills/workflow-commands/pre-gate-cut.md`. Reissue this edit once the cut has ' +
	'answered — an edit reissued right after this refusal passes, so `busy` / `failed` cannot wedge the ' +
	'run edit after edit; this fires again on the next threshold crossing rather than once per run.'

// **A refusal younger than this window is this edit's own refusal being answered**.
// A `decide` row that refused every over-threshold edit would wedge a run whose cut came back `busy` /
// `failed` / `unready` — the very cases once-per-run relied on the reissue passing through. So an edit
// reissued inside this window passes: it is longer than a refusal-then-reissue round trip, so the
// reissue always lands inside it, while a genuinely new crossing past the window refuses again.
const REISSUE_WINDOW_MS = 90_000

function is_reissued_refusal(now_ms: number, delivered_at_ms: number): boolean {
	return now_ms - delivered_at_ms < REISSUE_WINDOW_MS
}

// **Fires on every threshold crossing rather than once per run**. Once per run
// silenced the row for the rest of a process the moment its first refusal landed — and a `busy` /
// `failed` / `unready` verdict, or an edit reissued unchanged, left the context to grow unwatched to
// 282,747 tokens with the cut never taken. `decide` re-asks on every over-threshold edit; the reissue
// window is what keeps that from wedging a run that genuinely cannot cut. `delivered_at_ms` is this
// row's own last refusal, written by `fire_once` only when a refusal actually fired, so a passed
// reissue does not move it.
function decide(
	_call: GuardedCall,
	run: GuardRun,
	_can_record: boolean,
	delivered_at_ms: number,
): boolean {
	return !is_reissued_refusal(run.now_ms, delivered_at_ms)
}

// The row itself, so `delivered-rules.ts` spreads one entry. `decide` fires it per threshold crossing;
// `keeps` is the implementation cut command, read from a `Bash` call the same
// way `pre-gate-cut`'s is.
const ROW = {
	id: 'implementation-cut',
	is_trigger: is_over_threshold_edit,
	reason: IMPLEMENTATION_CUT_REASON,
	decide,
	keeps: bash_triggers.on_bash_command(takes_the_impl_cut),
}

const implementation_cut = {
	IMPLEMENTATION_CUT_REASON,
	REISSUE_WINDOW_MS,
	ROW,
	decide,
	is_over_threshold_edit,
	is_reissued_refusal,
	takes_the_impl_cut,
	uncut_run_issue,
}

export type { LaneCostState }
export { implementation_cut }
