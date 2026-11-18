import { lane_ledger, type LedgerEntry, type TestRelatedEntry } from './lane-ledger'

// What a lane's `josh test:related` runs left unchecked (joshuafolkken/kit#5532): the changed files
// past the reach cap, run by their direct importers alone, over the lane's runs.

const LABEL = 'test:related'

function is_lane_row(entry: LedgerEntry, issue: number): entry is TestRelatedEntry {
	return entry.kind === lane_ledger.KIND.TEST_RELATED && entry.issue === issue
}

// The hub the most capped runs named, the earliest on a tie (joshuafolkken/kit#5699); none where no
// run recorded one.
function top_hub(rows: ReadonlyArray<TestRelatedEntry>): string | undefined {
	const tally = new Map<string, number>()

	for (const { over_cap_hub } of rows) {
		if (over_cap_hub !== undefined) tally.set(over_cap_hub, (tally.get(over_cap_hub) ?? 0) + 1)
	}

	return [...tally].toSorted((first, second) => second[1] - first[1])[0]?.[0]
}

// The file that widened the widest-reaching run, with that reach (joshuafolkken/kit#7924): the hub is
// the lane's own capped file, not what ran wide. `''` where no run recorded one.
function widest_part(rows: ReadonlyArray<TestRelatedEntry>): string {
	const [widest] = rows.toSorted(
		(first, second) => (second.widest_tests ?? 0) - (first.widest_tests ?? 0),
	)
	if (widest?.widest_file === undefined) return ''

	return `, widest ${widest.widest_file} (${String(widest.widest_tests ?? 0)})`
}

// The line `josh lane:breakdown` prints, `''` when no run of `issue` capped a file. The count is the
// widest run's, the number its own summary line printed: a sum over runs counts one capped file once a
// run (joshuafolkken/kit#6187).
function over_cap_text(entries: ReadonlyArray<LedgerEntry>, issue: number): string {
	const rows = entries.filter((entry) => is_lane_row(entry, issue))
	const over_cap = Math.max(0, ...rows.map((row) => row.over_cap ?? 0))
	if (over_cap === 0) return ''
	const capped = rows.filter((row) => (row.over_cap ?? 0) > 0).length
	const hub = top_hub(rows)
	const text = `${LABEL} ${String(over_cap)} over cap, in ${String(capped)} of ${String(rows.length)} runs`
	const hub_part = hub === undefined ? '' : `, hub ${hub}`

	return text + hub_part + widest_part(rows)
}

const lane_breakdown_related = { over_cap_text }

export { lane_breakdown_related }
