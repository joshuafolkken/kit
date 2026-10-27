import { lane_breakdown, type Breakdown } from './lane-breakdown'
import { lane_ledger, type LedgerEntry, type TestPinnedEntry } from './lane-ledger'

// What a lane's ship pre-detach spent on `josh test:pinned` (joshuafolkken/kit#5078): the lane's
// `test-pinned` rows written inside that stage, as hunks the cache answered and the probed hunks'
// test files and wall time, the longest first.

type PinnedProbe = TestPinnedEntry['probes'][number]

// The longest probes named; the rest are counted in the head alone.
const MAX_SHOWN = 5

const DISCARDED_LABEL = 'run:review background test:pinned probes discarded'

function is_lane_row(entry: LedgerEntry, issue: number): entry is TestPinnedEntry {
	return entry.kind === lane_ledger.KIND.TEST_PINNED && entry.issue === issue
}

function is_discarded(entry: TestPinnedEntry): boolean {
	return entry.discarded === true
}

function is_in_pre_detach(entry: TestPinnedEntry, breakdown: Breakdown): boolean {
	const at_ms = Date.parse(entry.at)

	return breakdown.pre_detach.some((span) => at_ms >= span.from_ms && at_ms <= span.to_ms)
}

// `issue`'s `test-pinned` rows written inside its ship pre-detach stage.
function rows_of(
	entries: ReadonlyArray<LedgerEntry>,
	issue: number,
	breakdown: Breakdown,
): Array<TestPinnedEntry> {
	return entries
		.filter((entry) => is_lane_row(entry, issue))
		.filter((entry) => !is_discarded(entry) && is_in_pre_detach(entry, breakdown))
}

// `issue`'s `run:review` background probes stopped before their answer (joshuafolkken/kit#5262), as a
// count and their wall time; `''` when none was.
function discarded_text(entries: ReadonlyArray<LedgerEntry>, issue: number): string {
	const rows = entries
		.filter((entry) => is_lane_row(entry, issue))
		.filter((entry) => is_discarded(entry))
	if (rows.length === 0) return ''
	const elapsed_ms = rows.reduce((sum, row) => sum + row.elapsed_ms, 0)

	return `${DISCARDED_LABEL} ${String(rows.length)}, ${lane_breakdown.minutes_text(elapsed_ms)}`
}

function probe_text(probe: PinnedProbe): string {
	const tests = probe.tests === undefined ? '' : ` ${String(probe.tests)} test files`

	return `${probe.file}${tests} ${lane_breakdown.minutes_text(probe.elapsed_ms)}`
}

// The detail the pre-detach line carries, or `''` when no probe ran inside it.
function detail_text(rows: ReadonlyArray<TestPinnedEntry>): string {
	if (rows.length === 0) return ''
	const probes = rows
		.flatMap((row) => row.probes)
		.toSorted((left, right) => right.elapsed_ms - left.elapsed_ms)
	const held = rows.reduce((sum, row) => sum + row.held, 0)
	const rewired = rows.reduce((sum, row) => sum + (row.rewired ?? 0), 0)
	const total = held + rewired + probes.length
	const head = `test:pinned ${String(total)} hunks, ${String(held)} cached, ${String(probes.length)} probed`
	const counts = rewired === 0 ? [head] : [head, `${String(rewired)} rewired`]

	return ` (${[...counts, ...probes.slice(0, MAX_SHOWN).map((probe) => probe_text(probe))].join(', ')})`
}

const lane_breakdown_pinned = { detail_text, discarded_text, rows_of }

export { lane_breakdown_pinned }
