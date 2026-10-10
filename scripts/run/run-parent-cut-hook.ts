import { CONTEXT_CUT_THRESHOLD } from '#scripts/cost-runtime/context-cut-threshold'
import { cost_cli, type CostVerdict } from '#scripts/cost-runtime/cost-cli'
import { cost_format } from '#scripts/cost-runtime/cost-format'
import { cost_verdict } from '#scripts/cost-runtime/cost-verdict'
import { hook_decision } from '#scripts/josh/hook-decision'
import { error_text } from '#scripts/lib/error-message'
import { implementation_cut_verdict } from '#scripts/rules/implementation-cut-verdict'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { run_headless } from './run-headless'
import { run_watcher_hook } from './run-watcher-hook'

// The `backlogrun` parent's hand-off, delivered at the call it binds on.
//
// **A hand-off asked only at a merge goes unread while the context grows between merges.** The
// orchestrator never implements, but `pnpm josh cost --cut` is read after each child's merge
// (`backlogrun-progress.md` → "The hand-off"), and a long wait or a lane-failure investigation between
// two merges is where the context grows past the shared threshold. This is the lesson
// `implementation-cut.ts` records for a lane child, one session up — a check carried as a step is
// taken late, a `PreToolUse` refusal is taken at the next call.
//
// **The same statistic and the same threshold, never a second measurement.** The verdict is
// `cost_cli.session_verdict` — what `pnpm josh cost --cut` prints — read through the implementation cut's
// short reuse window so a burst of calls is priced once.
//
// **It is async and composed after the synchronous guards, like the watcher guard.** Telling the parent
// apart reads the carry record through `run_headless.driving_carry`, which is asynchronous; reusing it is
// what keeps a second, synchronous spelling of the parent test from existing.

const SWITCH_ENV_KEY = 'JOSH_PARENT_CUT_GUARD'
const STAMP_PREFIX = 'josh-parent-cut-guard-'

// **One refusal, then a quiet window long enough to finish the hand-off in.** The hand-off is several
// calls — `lane:list`, `lane:output`, `run:carry --cut`, `run:wake`, the progress comment — and a guard
// refusing each of them would wedge the very procedure it asks for. A parent that could not cut (a lane
// nobody can poll) is asked again once the window has passed.
const QUIET_WINDOW_MS = 600_000

// What the decision has to know about the world, passed in so it is testable without a carry record or
// a session transcript on disk.
interface ParentCutState {
	carry: () => Promise<RunCarry | undefined>
	verdict: () => CostVerdict
}

function current_state(): ParentCutState {
	return {
		carry: async (): Promise<RunCarry | undefined> => await run_headless.driving_carry(),
		verdict: (): CostVerdict =>
			implementation_cut_verdict.reused_verdict(() => cost_cli.session_verdict()),
	}
}

const THRESHOLD_TEXT = `${cost_format.format_tokens(CONTEXT_CUT_THRESHOLD)}-token`

const PARENT_CUT_REASON =
	'⛔ backlogrun parent hand-off: this session drives a `backlogrun` (it owns the live carry record) and ' +
	`its recent-context cost has crossed the shared ${THRESHOLD_TEXT} threshold between merges, so every ` +
	'later request re-reads the accumulated context (joshuafolkken/kit#2947). Take the hand-off now rather ' +
	'than at the next merge: follow `.claude/skills/workflow-commands/backlogrun-progress.md` → "The ' +
	'hand-off" from its `over` branch — open no new lane and take no new child, read `pnpm josh lane:list`, ' +
	'make sure every lane in flight records an output path, then run `pnpm josh run:carry --cut --owner ' +
	'"$PPID"` and, unless it answers `capped`, `pnpm josh run:wake`, post the progress comment and end the ' +
	'turn. A lane nobody can poll means the cut does not happen; carry on and this asks again later. ' +
	'Reissue this call when the hand-off is done or cannot be taken — the guard stays quiet for a while ' +
	'after it refuses, so the hand-off calls themselves are not refused.'

// Neither an uncapped parent's own record nor a measured `over` is optional: a capped record has no cut
// left to take (`run:carry --cut` answers `capped`), and an unmeasurable session is left alone here —
// refusing every call of a session that cannot be priced would wedge it, while the merge-seam check
// still takes `over`'s branch for it.
async function is_due(state: ParentCutState): Promise<boolean> {
	const carry = await state.carry()

	if (carry === undefined || run_headless.is_cut_capped(carry)) return false

	return state.verdict() === cost_verdict.OVER_VERDICT
}

function is_quiet(target: string, now_ms: number): boolean {
	const last_ms = hook_decision.create_refusal_stamp(STAMP_PREFIX).last_ms(target)

	return last_ms !== hook_decision.NEVER_MS && now_ms - last_ms < QUIET_WINDOW_MS
}

// The quiet window is read before the carry record and the transcript price, so a refused parent's
// following calls cost one small file read each.
async function refusal_for(
	transcript: string,
	now_ms: number,
	state: ParentCutState,
): Promise<string | undefined> {
	const stamp = hook_decision.create_refusal_stamp(STAMP_PREFIX)
	const target = stamp.path(transcript)

	if (is_quiet(target, now_ms) || !(await is_due(state))) return undefined

	return stamp.record(target, now_ms) ? PARENT_CUT_REASON : undefined
}

// A delegated unit's call names the *parent's* transcript and runs under the parent's process, so the
// carry record reads as owned here; only `agent_id` tells it apart (`hook-decision.ts`). Refusing it
// would hand the unit a hand-off it cannot take and spend the parent's quiet window on it.
function is_unit_call(raw_payload: string): boolean {
	try {
		return (hook_decision.parse_hook_payload(raw_payload)?.agent_id ?? '') !== ''
	} catch (error) {
		error_text.trace_swallowed('run_parent_cut_hook.is_unit_call', error)

		return false
	}
}

function is_exempt(raw_payload: string): boolean {
	return !hook_decision.is_switch_enabled(SWITCH_ENV_KEY) || is_unit_call(raw_payload)
}

/**
 * The deny reason for a call a `backlogrun` parent makes past the shared threshold, or `undefined` when
 * the call proceeds — a lane child, a delegated unit, a person's session, a handed-off or capped
 * record, an `under` or unmeasurable verdict, or a call inside the quiet window after a refusal.
 */
async function parent_cut_reason(
	raw_payload: string,
	now_ms: number = Date.now(),
	state: ParentCutState = current_state(),
): Promise<string | undefined> {
	if (is_exempt(raw_payload)) return undefined

	const transcript = run_watcher_hook.transcript_of(raw_payload)

	if (transcript === undefined) return undefined

	return await refusal_for(transcript, now_ms, state)
}

const run_parent_cut_hook = {
	PARENT_CUT_REASON,
	QUIET_WINDOW_MS,
	SWITCH_ENV_KEY,
	parent_cut_reason,
}

export type { ParentCutState }
export { run_parent_cut_hook }
