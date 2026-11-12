import { lane_ledger } from '#scripts/lane/lane-ledger'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'

// An entry can start without lane:dispatch. Preserve the first start it already recorded;
// explicit lane dispatches still append through record_dispatch (joshuafolkken/kit#6304).
async function record_missing(issue: number): Promise<void> {
	const path = await lane_ledger.target()

	if (path === undefined) return

	const is_recorded = lane_ledger
		.read_entries(path)
		.some((entry) => entry.kind === lane_ledger.KIND.DISPATCH && entry.issue === issue)

	if (!is_recorded) await lane_ledger_write.record_dispatch(issue, path)
}

const run_entry_dispatch = { record_missing }

export { run_entry_dispatch }
