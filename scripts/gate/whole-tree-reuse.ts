import { check_reuse, type CheckRecords } from './check-reuse'
import { gate_plan } from './gate-plan'
import type { GateTree } from './gate-tree'
import { project_checks } from './project-checks'

// The `josh gate` flag the ship's gate on the final tree passes: the lane's gate plus the whole-tree checks.
const WHOLE_TREE_FLAG = '--whole-tree'

// **A green gate record proves the checks of the gate that wrote it**, and a lane's own gate leaves the
// whole-tree checks out (joshuafolkken/kit#7030). So a gate that must run them — the ship's, on the
// final tree — reuses that record only where each whole-tree check's own record is reusable on this
// tree too. No records to read is the run-it answer, so a suite driving the gate never reuses one.
async function is_reused(tree: GateTree, records: CheckRecords | undefined): Promise<boolean> {
	if (records === undefined) return false

	const labels = gate_plan.whole_tree_labels(project_checks.is_kit_repository(process.cwd()))
	const reused = await check_reuse.reusable_checks(labels, tree, records)

	return labels.every((label) => reused.has(label))
}

const whole_tree_reuse = { WHOLE_TREE_FLAG, is_reused }

export { whole_tree_reuse }
