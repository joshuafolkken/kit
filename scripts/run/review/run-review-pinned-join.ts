import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { error_text } from '#scripts/lib/error-message'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import type { PinnedSummary } from '#scripts/test/test-pinned-record'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_pinned_tree } from './run-review-pinned-tree'

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

// `--join`'s read: the current tree's answer, never a pre-fix tree's. `undefined` when no check was
// launched. **A ship's own round restarts nothing and leaves nothing running**: under its supervisor
// no `--pinned` read follows, and the check would hold cores the ship's gate waits on
// (`review-record-code-round.ts`).
async function wait_for_join(
	root: string = PROJECT_ROOT,
	now?: Clock,
): Promise<PinnedSummary | undefined> {
	const is_read_later = !run_ship_detach.is_supervised()

	if (is_read_later) await is_restarted(root)

	return await run_review_pinned_steps.wait_for_answer(root, now, is_read_later)
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

// The answer of the check launched on this very tree, waited for; `undefined` when none was, or it left
// none, so the caller runs its own. A check on another tree is stopped first, so it does not run beside
// the caller's own.
async function answer_on_tree(root: string = PROJECT_ROOT): Promise<PinnedSummary | undefined> {
	if (await is_launched_on_current_tree(root)) return await waited_answer(root)
	run_review_pinned_steps.clear(root)

	return undefined
}

const run_review_pinned_join = { answer_on_tree, restart_if_moved, wait_for_join }

export { run_review_pinned_join }
