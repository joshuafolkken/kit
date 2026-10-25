import type { Finding } from './review-finding-ledger'
import { review_lane_handover } from './review-lane-handover'
import { review_record_interaction } from './review-record-interaction'
import { review_record_pinned } from './review-record-pinned'
import { review_reviewed_tree } from './review-reviewed-tree'

// What `josh review:record` does once a code round is on the ledger: it records the tree the verdict
// stands for, which `josh ship` reuses while the tree holds still (`review-reviewed-tree.ts`), names the
// ship next for a lane child (`review-lane-handover.ts`), names an interaction review its fixes made due (`review-record-interaction.ts`), and starts `josh test:pinned`
// again on a tree its fixes moved (`review-record-pinned.ts`).

const HIGH_SEVERITY = 'high'

// The files whose finding the round could not have fixed in place — a High never is.
function unsettled_files(findings: ReadonlyArray<Finding>): ReadonlyArray<string> {
	return findings
		.filter((finding) => finding.severity === HIGH_SEVERITY)
		.map((finding) => finding.file)
}

// A lane child's round the ship reuses names the ship next (joshuafolkken/kit#4850), read after the
// tree is stamped; the lines that follow name what is done before that ship.
async function report_handover(issue: number): Promise<void> {
	if (await review_lane_handover.is_handed_over(issue)) {
		console.info(review_lane_handover.NEXT_STEP_LINE)
	}
}

async function follow(
	issue: number,
	root: string,
	findings: ReadonlyArray<Finding>,
): Promise<void> {
	await review_reviewed_tree.record(unsettled_files(findings))
	await report_handover(issue)
	await review_record_interaction.report_due(issue, root)
	await review_record_pinned.restart_if_moved(root)
}

const review_record_code_round = { follow }

export { review_record_code_round }
