import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import type { Finding } from './review-finding-ledger'
import { review_lane_handover } from './review-lane-handover'
import { review_record_interaction } from './review-record-interaction'
import { review_record_pinned } from './review-record-pinned'
import { review_reviewed_tree } from './review-reviewed-tree'

// What `josh review:record` does once a code round is on the ledger: it records the tree the verdict
// stands for, which `josh ship` reuses while the tree holds still (`review-reviewed-tree.ts`), names
// the ship next for a lane child (`review-lane-handover.ts`), names an interaction review its fixes
// made due (`review-record-interaction.ts`), reads a `josh run:review --join` the lane skipped, and
// starts `josh test:pinned` again on a tree its fixes moved (`review-record-pinned.ts`).

const HIGH_SEVERITY = 'high'

// The files whose finding the round could not have fixed in place — a High never is.
function unsettled_files(findings: ReadonlyArray<Finding>): ReadonlyArray<string> {
	return findings
		.filter((finding) => finding.severity === HIGH_SEVERITY)
		.map((finding) => finding.file)
}

// A lane child's round the ship reuses names the ship next (joshuafolkken/kit#4850), read after the
// tree is stamped; the lines that follow name what is done before that ship.
async function report_handover(issue: number): Promise<boolean> {
	const is_handed_over = await review_lane_handover.is_handed_over(issue)

	if (is_handed_over) console.info(review_lane_handover.NEXT_STEP_LINE)

	return is_handed_over
}

// Only a lane child's round the ship will reuse restarts the check: the ship's own rounds run under its
// supervisor, where nothing reads the answer and the check would hold cores the ship's gate waits on.
function is_restarted_here(is_handed_over: boolean): boolean {
	return is_handed_over && !run_ship_detach.is_supervised()
}

async function follow(
	issue: number,
	root: string,
	findings: ReadonlyArray<Finding>,
): Promise<void> {
	await review_reviewed_tree.record(unsettled_files(findings))
	const is_handed_over = await report_handover(issue)

	await review_record_interaction.report_due(issue, root)
	if (!is_restarted_here(is_handed_over)) return
	await review_record_pinned.read_skipped_join(root)
	await review_record_pinned.restart_if_moved(root)
}

const review_record_code_round = { follow }

export { review_record_code_round }
