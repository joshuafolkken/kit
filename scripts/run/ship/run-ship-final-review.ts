import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { file_map_stamp, type FileMapStamp } from '#scripts/josh/file-map-stamp'
import { review_round_reuse } from '#scripts/review/review-round-reuse'
import type { StepResult } from './run-ship-sync'

function matches(prior: FileMapStamp | undefined, tree: GateTree): boolean {
	if (prior?.completed_at === undefined || Object.keys(tree.files).length === 0) return false

	return (
		file_map_stamp.describes_base(prior, tree.base) &&
		file_map_stamp.changed_since(prior, tree.files).length === 0
	)
}

// A completed final review survives a gate or commit stop only on exactly the tree it read.
async function run(issue: string, review: () => Promise<StepResult>): Promise<StepResult> {
	const stamp = file_map_stamp.create(`josh-ship-final-review-${issue}-`, PROJECT_ROOT)
	const tree = await gate_tree.read_gate_tree()
	const prior = stamp.read()
	const is_stale = await review_round_reuse.is_stale_here()

	if (!is_stale && matches(prior, tree)) {
		return { code: 0, out: 'final round 2 reused on the reviewed tree', is_skipped: true }
	}

	stamp.write(tree.files, undefined, tree.base)
	const result = await review()

	if (result.code === 0) stamp.complete()

	return result
}

const run_ship_final_review = { run }

export { run_ship_final_review }
