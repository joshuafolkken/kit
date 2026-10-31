import { lane_ledger, type LedgerEntry, type TestRelatedEntry } from './lane-ledger'

// What a lane's `josh test:related` runs left unchecked (joshuafolkken/kit#5532): the changed files
// past the reach cap, run by their direct importers alone, summed over the lane's runs.

const LABEL = 'test:related'

function is_lane_row(entry: LedgerEntry, issue: number): entry is TestRelatedEntry {
	return entry.kind === lane_ledger.KIND.TEST_RELATED && entry.issue === issue
}

// The line `josh lane:breakdown` prints, `''` when no run of `issue` capped a file.
function over_cap_text(entries: ReadonlyArray<LedgerEntry>, issue: number): string {
	const rows = entries.filter((entry) => is_lane_row(entry, issue))
	const over_cap = rows.reduce((sum, row) => sum + (row.over_cap ?? 0), 0)
	if (over_cap === 0) return ''
	const capped = rows.filter((row) => (row.over_cap ?? 0) > 0).length

	return `${LABEL} ${String(over_cap)} over cap, in ${String(capped)} of ${String(rows.length)} runs`
}

const lane_breakdown_related = { over_cap_text }

export { lane_breakdown_related }
