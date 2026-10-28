import { setTimeout as sleep } from 'node:timers/promises'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { error_text } from '#scripts/lib/error-message'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { test_pinned } from '#scripts/test/test-pinned'
import { test_pinned_logic } from '#scripts/test/test-pinned-logic'
import { test_pinned_record, type PinnedSummary } from '#scripts/test/test-pinned-record'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_pinned_tree } from './run-review-pinned-tree'
import { run_review_steps } from './run-review-steps'

// One `josh test:pinned` answer per tree (joshuafolkken/kit#4888): every reader of the background check
// `josh run:review` launched — `--join`, `josh review:record` and the ship's pre-detach — reads it for
// the tree in front of it, and none runs the check again by hand.
//
// **A moved tree starts the check again on it, and the old one is not waited on.** A round-1 fix moves
// the tree under the launch; `--join` then waited out the grace on the pre-fix check and stopped it
// (joshuafolkken/kit#4878). Restarting on the current tree, with the launch's `--unpinned-ok` reason,
// probes only the hunks the shared verdict cache no longer holds (`test-pinned-cache.ts`).
//
// **The same tree starts nothing**, and so does a tree either side could not read, or a checkout with
// no launch.

type Clock = () => number
type Pause = () => Promise<void>

const PENDING_NOTE =
	'`josh test:pinned` is still running; the hunks below are unpinned by the verdicts it already reached; the round is not stopped on them:'
const RESTARTED_NOTE =
	"started again on the moved tree — it is left running for the ship's pre-detach to read"

// The current tree's digest when it differs from the launch's; `undefined` when nothing is to start.
async function moved_tree(root: string): Promise<string | undefined> {
	const launched = run_review_pinned_steps.launched_tree(root)
	if (launched === undefined) return undefined
	const current = await run_review_pinned_tree.key()

	return current === launched ? undefined : current
}

// The launch's reason is read before `clear` removes its record.
function restart(root: string, tree: string): boolean {
	const reason = run_review_pinned_steps.launched_reason(root)

	run_review_pinned_steps.clear(root)

	return run_review_pinned_steps.launch(root, reason, tree).kind === 'launched'
}

// Whether a check was started again on the moved tree.
async function restart_if_moved(root: string = PROJECT_ROOT): Promise<boolean> {
	const tree = await moved_tree(root)

	return tree !== undefined && restart(root, tree)
}

// A tree git could not read is no move: the launch's check is waited on as it stands.
async function is_restarted(root: string): Promise<boolean> {
	try {
		return await restart_if_moved(root)
	} catch (error) {
		error_text.trace_swallowed('run_review_pinned_join.is_restarted', error)

		return false
	}
}

// The cached verdicts' unpinned hunks, read without a probe; `undefined` when none is unpinned or the
// tree could not be read, so the caller says the check is still running.
async function cached_summary(): Promise<PinnedSummary | undefined> {
	try {
		const report = await test_pinned.cached(test_pinned_logic.DEFAULT_MAX_HUNKS)

		return report.unpinned.length === 0
			? undefined
			: test_pinned_record.partial_summary(report, PENDING_NOTE)
	} catch (error) {
		error_text.trace_swallowed('run_review_pinned_join.cached_summary', error)

		return undefined
	}
}

// A check still running answers with what the shared cache already holds for the hunks that did not
// move (joshuafolkken/kit#4936), so round 1 can pin them in its own fixes.
async function fixing_answer(root: string, note: string): Promise<PinnedSummary | undefined> {
	const cached = run_review_pinned_steps.is_pending(root) ? await cached_summary() : undefined

	return cached ?? run_review_pinned_steps.answer_now(root, note)
}

// Restarts the check on a moved tree whatever the round, then why the join waits no grace on it;
// `undefined` when it does wait.
async function graceless_note(root: string, is_fixing: boolean): Promise<string | undefined> {
	const is_fresh = await is_restarted(root)

	if (is_fixing) return run_review_pinned_steps.FIXING_NOTE

	return is_fresh ? RESTARTED_NOTE : undefined
}

// `--join`'s read: the current tree's answer, never a pre-fix tree's. `undefined` when no check was
// launched. **A ship's own round restarts nothing and leaves nothing running**: under its supervisor
// no `--pinned` read follows, and the check would hold cores the ship's gate waits on
// (`review-record-code-round.ts`). **A round 1 with fixes to make waits no grace**
// (joshuafolkken/kit#4895): the fix moves the tree, so this tree's late answer would go unused. **Nor
// does a check it just started again** (joshuafolkken/kit#5002), `--fixing` or not: a fresh probe never
// ends within the grace, and the ship's pre-detach reads it on this tree.
async function wait_for_join(
	root: string = PROJECT_ROOT,
	now?: Clock,
	is_fixing = false,
): Promise<PinnedSummary | undefined> {
	if (run_ship_detach.is_supervised()) {
		return await run_review_pinned_steps.wait_for_answer(root, now, false)
	}

	const note = await graceless_note(root, is_fixing)

	return note === undefined
		? await run_review_pinned_steps.wait_for_answer(root, now)
		: await fixing_answer(root, note)
}

// A tree git could not read is not the launch's, so the caller runs its own check.
async function is_launched_on_current_tree(root: string): Promise<boolean> {
	const launched = run_review_pinned_steps.launched_tree(root)
	if (launched === undefined) return false

	try {
		return launched === (await run_review_pinned_tree.key())
	} catch (error) {
		error_text.trace_swallowed('run_review_pinned_join.is_launched_on_current_tree', error)

		return false
	}
}

async function waited_answer(root: string): Promise<PinnedSummary | undefined> {
	const summary = await run_review_pinned_steps.wait_alone(root)

	return run_review_pinned_steps.is_answered(root) ? summary : undefined
}

// A check on another tree is waited out, not stopped (joshuafolkken/kit#4895): the caller's own check,
// run after it rather than beside it, then reads every verdict it reached from the shared cache and
// probes only the hunks that moved since. A lone read's bound still stops one that hung. Only a check
// proven live is waited on: a stale stamp goes straight to `clear`, which signals no unproven pid.
async function settle_elsewhere(root: string): Promise<void> {
	if (run_review_pinned_steps.is_live(root)) await run_review_pinned_steps.wait_alone(root)
	run_review_pinned_steps.clear(root)
}

// The answer of the check launched on this very tree, waited for; `undefined` when none was, or it left
// none, so the caller runs its own.
async function answer_on_tree(root: string = PROJECT_ROOT): Promise<PinnedSummary | undefined> {
	if (await is_launched_on_current_tree(root)) return await waited_answer(root)
	await settle_elsewhere(root)

	return undefined
}

// The answer a check launched on this very tree already left, read without waiting
// (joshuafolkken/kit#4920); `undefined` when the tree moved, the check is still running or left none.
async function finished_on_tree(root: string = PROJECT_ROOT): Promise<PinnedSummary | undefined> {
	if (!run_review_pinned_steps.is_answered(root)) return undefined

	return (await is_launched_on_current_tree(root))
		? run_review_pinned_steps.answer_now(root)
		: undefined
}

async function poll_pause(): Promise<void> {
	await sleep(run_review_steps.POLL_INTERVAL_MS)
}

function is_ended(root: string): boolean {
	return run_review_pinned_steps.is_answered(root) || !run_review_pinned_steps.is_live(root)
}

// The check launched on this very tree, still running: not answered, not ended, and the tree unmoved.
async function is_coming_on_tree(root: string): Promise<boolean> {
	return !is_ended(root) && (await is_launched_on_current_tree(root))
}

async function wait_on_tree(root: string, is_within: () => boolean, pause: Pause): Promise<void> {
	// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
	while (is_within() && (await is_coming_on_tree(root))) await pause()
}

// **The answer of a check the caller just started on this tree, waited for** (joshuafolkken/kit#4987):
// `josh check:related` ended before the probe it restarted, printed no verdict, and the ship's
// pre-detach stopped on the unpinned places instead. The wait ends once the tree moves, the check ends
// or the caller's grace runs out, and answers as `finished_on_tree` then does — never stopping it.
async function settled_on_tree(
	root: string,
	grace_ms: number,
	now: Clock = () => Date.now(),
	pause: Pause = poll_pause,
): Promise<PinnedSummary | undefined> {
	const started = now()

	await wait_on_tree(root, () => now() - started < grace_ms, pause)

	return await finished_on_tree(root)
}

const run_review_pinned_join = {
	answer_on_tree,
	finished_on_tree,
	restart_if_moved,
	settled_on_tree,
	wait_for_join,
}

export { run_review_pinned_join }
