import { CONTEXT_CUT_THRESHOLD } from '#scripts/cost-runtime/context-cut-threshold'
import { cost_cli, type CostVerdict } from '#scripts/cost-runtime/cost-cli'
import { cost_format } from '#scripts/cost-runtime/cost-format'
import { cost_verdict } from '#scripts/cost-runtime/cost-verdict'
import type { GuardRun } from '#scripts/josh/hook-decision'
import { lane_child_marker, type MarkerSource } from '#scripts/lane/lane-child-marker'
import { lane_paths } from '#scripts/lane/lane-paths'
import { run_cut, type RunCut } from '#scripts/run/run-cut'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { bash_triggers } from './bash-triggers'
import { implementation_cut_verdict } from './implementation-cut-verdict'
import { shell_segments } from './shell-segments'

// The implementation-phase cut, delivered at the call it binds on (joshuafolkken/kit#2310).
//
// **The mechanism was there and the verdict was taken at the wrong time.** joshuafolkken/kit#1933
// built the second cut boundary — a lane child ends its process *during* implementation once its
// recent-context cost crosses the shared threshold, and a fresh one resumes back into implementation —
// and left the child to run `pnpm josh cost --cut` at each working-tree boundary itself. It never did.
// The five lanes joshuafolkken/kit#2310 measured (#2304 #2294 #2297 #2296 #2298) each read the verdict
// exactly once, at session entry where the context has not yet grown — so the check answered `under`
// by construction and the cut fired 0 times while 33.9% of their requests ran past 200,000 tokens.
//
// **This is the same lesson pre-gate-cut.ts records, one boundary earlier.** joshuafolkken/kit#1864
// measured the pre-gate cut taken 0 times while it was carried as prose, and a `PreToolUse` refusal is
// what took it. joshuafolkken/kit#1933 had reasoned the implementation cut *could not* be a guard,
// because the per-request cost was read asynchronously; but `cost_cli.session_verdict` is synchronous
// and is the very verdict `pnpm josh cost --cut` prints, so the guard reads it directly rather than
// approximating it — the same statistic and the same threshold, never the second measurement #1933
// forbids.

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
// body is not read as the call, and alias-expanded so `pnpm josh rct --impl` is the same call.
function takes_the_impl_cut(command: string): boolean {
	return shell_segments.segments_of(command).some((segment) => is_impl_cut_segment(segment))
}

// What the trigger has to know about the world, passed in so the decision is testable without a lane on
// disk, a cut record, or a session transcript. `verdict` is the synchronous `pnpm josh cost --cut`
// reading — the same per-request billed-input statistic against the same threshold — so the guard
// prices its cut on exactly what the parent hand-off does (joshuafolkken/kit#1933).
interface LaneCostState {
	directory: string
	source: MarkerSource
	carried: (now?: Date) => RunCut | undefined
	verdict: () => CostVerdict
}

function current_state(): LaneCostState {
	return {
		directory: process.cwd(),
		source: process.env,
		carried: run_cut.carried_cut_sync,
		// **Read through the short reuse window** (joshuafolkken/kit#2385). The row now fires per
		// threshold crossing rather than once per run, so this predicate is a candidate on every edit;
		// the window collapses one turn's burst of edits to a single whole-transcript price.
		verdict: (): CostVerdict =>
			implementation_cut_verdict.reused_verdict(() => cost_cli.session_verdict()),
	}
}

// A dispatched lane child for this checkout with no cut already carried. The dispatch mark is what
// tells a child apart from a person (joshuafolkken/kit#1904), read from the environment against this
// lane's own issue so a leaked mark for another issue reads as a person. **The carried-cut half keeps
// the guard silent between a cut and its resume**, exactly as `pre-gate-cut.ts`'s does: a record naming
// this issue means a cut is already in flight, and `begin_cut`'s exclusive create would refuse a second
// one anyway.
function uncut_lane_child_issue(state: LaneCostState): string | undefined {
	if (!lane_child_marker.is_child_of(state.directory, state.source)) return undefined

	const issue = lane_paths.lane_issue_of(state.directory, { ...state.source })

	if (issue === undefined) return undefined

	return state.carried()?.issue === issue ? undefined : issue
}

// **The tool-name test comes first and the world is consulted second, the cost measurement last.** This
// predicate is asked of every call in the run, so the `Edit` / `Write` string match keeps the lane read
// off all but the edits, and the lane read keeps the transcript-priced verdict off every edit but those
// a dispatched child makes in an uncut lane — where crossing the threshold is exactly the event this
// guard exists to catch.
//
// **The unmeasurable direction matches the pre-gate cut** (joshuafolkken/kit#2385). A session that
// cannot be priced reads as warranting the cut, the same safety-net direction `pre-gate-cut.ts`'s
// `warrants_the_cut` takes (`verdict !== UNDER_VERDICT`): the two rules read one statistic against one
// threshold, so they must not disagree about whether an unmeasurable session is due a cut.
function is_over_threshold_edit(
	call: GuardedCall,
	state: LaneCostState = current_state(),
): boolean {
	if (!is_edit_tool(call.name) || uncut_lane_child_issue(state) === undefined) return false

	return state.verdict() !== cost_verdict.UNDER_VERDICT
}

// **The threshold in the refusal text is assembled from the constant, never spelled** (joshuafolkken/kit#2385).
// joshuafolkken/kit#2374 lowered the shared threshold and the literal `200,000` stayed behind in this
// text, telling agents the wrong number; building it from `CONTEXT_CUT_THRESHOLD` is what keeps the two
// from ever drifting again. `cost_format.format_tokens` renders it the way every cost report does.
const THRESHOLD_TEXT = `${cost_format.format_tokens(CONTEXT_CUT_THRESHOLD)}-token`

// The instruction in the shape a refusal can carry: what the cut is for, what each verdict means, and
// the reissue sentence every delivery needs. The verdicts are spelled out rather than pointed at,
// because `cut` is the only one that ends the turn and a run told merely to "take the cut" would have to
// read which of the others leave it implementing — the same reason `pre-gate-cut.ts` spells them out.
const IMPLEMENTATION_CUT_REASON =
	'⛔ implementation-phase cut: this checkout is a lane dispatched for this issue and its recent-context ' +
	`cost has crossed the shared ${THRESHOLD_TEXT} threshold mid-implementation, so the thinking accumulated ` +
	'so far is now re-read on every later request. Take the cut before this edit. ' +
	'First write a handoff file with the Write tool — the user’s instruction verbatim, what you have ' +
	'completed, what remains, and what you deliberately did not touch — and pass it as `--handoff <path>`, ' +
	'so the fresh process resumes on the original instruction rather than the working tree alone ' +
	'(joshuafolkken/kit#2354); a resume that finds no instruction is refused `incomplete` rather than ' +
	'continuing blind. ' +
	'`pnpm josh run:cut --impl <N> --handoff <path>` ends this process and relaunches a fresh one that resumes back into ' +
	'implementation (`resume-impl`), dropping the accumulated context rather than carrying it — ' +
	'joshuafolkken/kit#1933 built the boundary and joshuafolkken/kit#2310 measured it firing 0 times ' +
	'because the verdict was only ever read at session entry, where the context has not yet grown. The ' +
	"verdict is `pnpm josh cost --cut`'s exactly — the same per-request billed-input statistic against the " +
	'same threshold, never a second measurement. Issue `pnpm josh run:cut --impl <N> --handoff <path>` now and read the ' +
	'verdict: on `cut`, **end the turn immediately** — the fresh process owns the run and continues ' +
	'implementing, so it must not be waited for; on `not-a-lane`, `unready`, `busy`, `failed` or ' +
	'`unknown`, this process carries the run on and the edit is simply the next call. Never relaunch a ' +
	'second process after `busy`. This fired because the dispatch mark names this lane; a person working ' +
	'here carries no mark and sees no refusal, so there is no human-or-child judgement left to make. The ' +
	'procedure is `.claude/skills/workflow-commands/pre-gate-cut.md`. Reissue this edit once the cut has ' +
	'answered — an edit reissued right after this refusal passes, so `busy` / `failed` cannot wedge the ' +
	'run edit after edit; this fires again on the next threshold crossing rather than once per run.'

// **A refusal younger than this window is this edit's own refusal being answered** (joshuafolkken/kit#2385).
// A `decide` row that refused every over-threshold edit would wedge a run whose cut came back `busy` /
// `failed` / `unready` — the very cases once-per-run relied on the reissue passing through. So an edit
// reissued inside this window passes: it is longer than a refusal-then-reissue round trip, so the
// reissue always lands inside it, while a genuinely new crossing past the window refuses again.
const REISSUE_WINDOW_MS = 90_000

function is_reissued_refusal(now_ms: number, delivered_at_ms: number): boolean {
	return now_ms - delivered_at_ms < REISSUE_WINDOW_MS
}

// **Fires on every threshold crossing rather than once per run** (joshuafolkken/kit#2385). Once per run
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

// The row itself, so `delivered-rules.ts` spreads one entry. `decide` fires it per threshold crossing
// (joshuafolkken/kit#2385); `keeps` is the implementation cut command, read from a `Bash` call the same
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
	is_edit_tool,
	is_over_threshold_edit,
	is_reissued_refusal,
	takes_the_impl_cut,
	uncut_lane_child_issue,
}

export type { LaneCostState }
export { implementation_cut }
