import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { error_text } from '#scripts/lib/error-message'
import { run_review_pinned_steps } from '#scripts/run/review/run-review-pinned-steps'
import { run_review_pinned_tree } from '#scripts/run/review/run-review-pinned-tree'

// What `josh review:record` does about the background `josh test:pinned` (joshuafolkken/kit#4834).
//
// **A round-1 fix can add hunks the check never read**: `josh run:review` launched it on the briefed
// tree, and its join closed before the fix. The ship's pre-detach was then the first to name the fixed
// tree's unpinned places, and stopped on them. A recorded code round compares the fixed tree with the
// launch's and, where they differ, starts the check again with the launch's `--unpinned-ok` reason and
// names the command that reads its answer, so the lane pins them or gives its reason before the ship.
// Its verdicts land in the shared cache, so the pre-detach re-reads only what moved after it.
//
// **The same tree starts nothing**, and so does a tree either side could not read, or a checkout with
// no launch: the pre-detach checks the tree as it always has.

const READ_COMMAND = 'pnpm josh run:review --pinned'

function started_line(): string {
	return `test:pinned restarted in the background on the tree this round's fixes moved. Before \`josh ship\`, read its answer with \`${READ_COMMAND}\`: pin each unpinned place with a test that turns red without it, or ship with \`--unpinned-ok "<reason>"\`.`
}

// The fixed tree's digest when it differs from the launch's; `undefined` when nothing is to start.
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

// `root` is the checkout `josh run:review` keyed its launch to: the ledger root `review:record` writes
// under is the same working directory, and a test's temporary root holds no launch.
async function restart_if_moved(root: string = PROJECT_ROOT): Promise<void> {
	try {
		const tree = await moved_tree(root)

		if (tree !== undefined && restart(root, tree)) console.info(started_line())
	} catch (error) {
		error_text.trace_swallowed('review_record_pinned.restart_if_moved', error)
	}
}

const review_record_pinned = { READ_COMMAND, restart_if_moved, started_line }

export { review_record_pinned }
