import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import { review_brief } from '#scripts/review/review-brief'
import { review_stamps } from '#scripts/review/review-stamps'

// The record that `josh test:e2e` answered green on this exact tree (joshuafolkken/kit#4156). A stop
// before commit — `halfrun`'s, `needs-human-review`'s — has no CI E2E job behind it, so the stop asks
// this record instead of trusting that the run remembered to run the suite.
//
// **A printed skip is recorded too**: a project with no suite, or without `@playwright/test`, has
// answered the question, and refusing its stop would make the record a requirement no such project
// could meet. **Any edit after the run moves the tree**, so the record no longer matches — the same
// reading the gate's own record takes (`gate-skip.ts`).

// Swallowed: a record not written is the safe answer — the stop refuses and the run re-runs the suite.
function record(tree: GateTree, target?: string): void {
	try {
		review_stamps.e2e_stamp.write(tree.files, target, tree.base)
	} catch {
		/* no record — the stop asks for the suite again */
	}
}

// An unread base or an unreadable record answers no: nothing established, nothing concluded.
function is_current(tree: GateTree, source?: string): boolean {
	if (tree.base === undefined) return false

	const stamp = review_brief.matching_stamp(review_stamps.e2e_stamp.read(source), tree.files)

	return stamp?.base === tree.base
}

async function is_current_tree(): Promise<boolean> {
	return is_current(await gate_tree.read_gate_tree())
}

const test_e2e_stamp = { is_current, is_current_tree, record }

export { test_e2e_stamp }
