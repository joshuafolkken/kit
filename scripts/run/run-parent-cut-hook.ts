import { cost_cli, type CostVerdict } from '#scripts/cost-runtime/cost-cli'
import { cost_verdict } from '#scripts/cost-runtime/cost-verdict'
import { hook_context, type HookContext } from '#scripts/hooks/hook-context'
import { hook_decision } from '#scripts/josh/hook-decision'
import { error_text } from '#scripts/lib/error-message'
import { implementation_cut_verdict } from '#scripts/rules/implementation-cut-verdict'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { time_shell } from '#scripts/time-runtime/time-shell'
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

// **The hand-off procedure is passed by name, never by the clock.** `run:handoff-lanes`, the `next:`
// line its verdict prints (`run:carry`, `run:board --chat`, `run:report --handoff`) and the lane repair a
// `blocked` verdict names (`lane:output`, `lane:prune`, `lane:list`) are the calls a refusal asks for, so
// a guard refusing them would wedge the procedure. Every other call is refused while the verdict is over.
const HANDOFF_COMMANDS: ReadonlySet<string> = new Set([
	'josh run:handoff-lanes',
	'josh run:carry',
	'josh run:board',
	'josh run:report',
	'josh lane:output',
	'josh lane:prune',
	'josh lane:list',
])

// What the decision has to know about the world, passed in so it is testable without a carry record or
// a session transcript on disk.
interface ParentCutState {
	carry: () => Promise<RunCarry | undefined>
	verdict: () => CostVerdict
}

// The world as the call in hand sees it: the carry record and session verdict under its own cwd, env
// and process ancestry.
function current_state(context: HookContext = hook_context.from_process()): ParentCutState {
	return {
		carry: async (): Promise<RunCarry | undefined> =>
			await run_headless.driving_carry(context.env, context.ancestry),
		verdict: (): CostVerdict =>
			implementation_cut_verdict.reused_verdict(
				() => cost_cli.session_verdict({ cwd: context.cwd, environment: context.env }),
				context.cwd,
			),
	}
}

// Named by its command, never spelled: the threshold is priced at the session's own model.
const THRESHOLD_TEXT = '`pnpm josh cost --cut`'

const PARENT_CUT_REASON =
	'⛔ backlogrun parent hand-off: this session drives a `backlogrun` and its recent context ' +
	`crossed the ${THRESHOLD_TEXT} threshold between merges. Take the hand-off now: open no new lane, ` +
	'follow `backlogrun-progress.md` → "The hand-off" (`pnpm josh run:handoff-lanes`, then the ' +
	'`next:` line its `cut` / `blocked` / `capped` verdict prints). Reissue this call once done or ' +
	'if it cannot be taken.'

// Neither an uncapped parent's own record nor a measured `over` is optional: a capped record has no cut
// left to take (`run:carry --cut` answers `capped`), and an unmeasurable session is left alone here —
// refusing every call of a session that cannot be priced would wedge it, while the merge-seam check
// still takes `over`'s branch for it.
async function is_due(state: ParentCutState): Promise<boolean> {
	const carry = await state.carry()

	if (carry === undefined || run_headless.is_cut_capped(carry)) return false

	return state.verdict() === cost_verdict.OVER_VERDICT
}

// A call is the hand-off only when every `josh` command it chains is one of the procedure's.
function is_handoff_call(raw_payload: string): boolean {
	// A payload with no transcript is no call of a session this guard can name, so it passes.
	if (run_watcher_hook.transcript_of(raw_payload) === undefined) return true

	const payload = hook_decision.parse_hook_payload(raw_payload)
	const commands = time_shell.josh_commands_of(time_shell.bash_command(payload?.tool_input))

	return commands.length > 0 && commands.every((command) => HANDOFF_COMMANDS.has(command))
}

async function refusal_for(
	raw_payload: string,
	state: ParentCutState,
): Promise<string | undefined> {
	if (is_handoff_call(raw_payload) || !(await is_due(state))) return undefined

	return PARENT_CUT_REASON
}

// A delegated unit's call names the *parent's* transcript and runs under the parent's process, so the
// carry record reads as owned here; only `agent_id` tells it apart (`hook-decision.ts`). Refusing it
// would hand the unit a hand-off it cannot take.
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
 * record, an `under` or unmeasurable verdict, or a call of the hand-off procedure itself.
 */
async function parent_cut_reason(
	raw_payload: string,
	state: ParentCutState = current_state(),
): Promise<string | undefined> {
	if (is_exempt(raw_payload)) return undefined

	return await refusal_for(raw_payload, state)
}

const run_parent_cut_hook = {
	PARENT_CUT_REASON,
	SWITCH_ENV_KEY,
	current_state,
	parent_cut_reason,
}

export type { ParentCutState }
export { run_parent_cut_hook }
