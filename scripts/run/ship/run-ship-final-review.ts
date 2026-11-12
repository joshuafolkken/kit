import { gate_tree } from '#scripts/gate/gate-tree'
import { review_final_record } from '#scripts/review/review-final-record'
import { review_round_reuse } from '#scripts/review/review-round-reuse'
import type { StepResult } from './run-ship-sync'
import { run_ship_tree_stamp } from './run-ship-tree-stamp'

// A completed final review survives a gate or commit stop only on exactly the tree it read: a
// re-entry runs round 2 again only when the tree moved since that pass, or the review went stale.
async function run(issue: string, review: () => Promise<StepResult>): Promise<StepResult> {
	const stamp = review_final_record.stamp(issue)
	const tree = await gate_tree.read_gate_tree()
	const is_stale = await review_round_reuse.is_stale_here()

	if (!is_stale && run_ship_tree_stamp.is_reusable(stamp, tree)) {
		return { code: 0, out: 'final round 2 reused on the reviewed tree', is_skipped: true }
	}

	stamp.write(tree.files, undefined, tree.base)
	const result = await review()

	run_ship_tree_stamp.complete(stamp, tree, result.code)

	return result
}

const run_ship_final_review = { run }

export { run_ship_final_review }
