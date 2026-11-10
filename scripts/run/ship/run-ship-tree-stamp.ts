import type { GateTree } from '#scripts/gate/gate-tree'
import {
	file_map_stamp,
	type FileMapStamp,
	type FileMapStampAccess,
} from '#scripts/josh/file-map-stamp'

// One ship stage's record of the tree it passed on: a re-entry on exactly that tree, base and inputs
// reuses the pass, and any move runs the stage again (joshuafolkken/kit#6986).

function matches(prior: FileMapStamp | undefined, tree: GateTree): boolean {
	if (prior?.completed_at === undefined || Object.keys(tree.files).length === 0) return false

	return (
		file_map_stamp.describes_base(prior, tree.base) &&
		file_map_stamp.changed_since(prior, tree.files).length === 0
	)
}

function is_reusable(stamp: FileMapStampAccess, tree: GateTree): boolean {
	const prior = stamp.read()

	return prior !== undefined && stamp.describes_inputs(prior) && matches(prior, tree)
}

// The tree read before the stage ran, so an edit made during it is never blessed.
function complete(stamp: FileMapStampAccess, tree: GateTree, code: number): void {
	if (code !== 0) return
	stamp.write(tree.files, undefined, tree.base)
	stamp.complete()
}

const run_ship_tree_stamp = { complete, is_reusable }

export { run_ship_tree_stamp }
