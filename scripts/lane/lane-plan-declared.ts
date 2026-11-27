import type { OpenIssueData } from '#scripts/git/git-schemas'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_plan_size } from './lane-plan-size'

// The size an Issue declares, put on the ledger as its lane plans (joshuafolkken/kit#8954), so the run
// board bands the row's finish before the merge writes its `size` record. An unread listing, or an Issue
// declaring no size, writes nothing; a re-plan writes again, and the board reads the latest.

async function record(
	issue: number,
	issues: ReadonlyArray<OpenIssueData> | undefined,
	path?: string,
): Promise<void> {
	const declared = issues === undefined ? undefined : lane_plan_size.declared_of(issue, issues)

	if (declared === undefined) return
	await lane_ledger_write.record_declared({ issue, ...declared }, path)
}

const lane_plan_declared = { record }

export { lane_plan_declared }
