import { lane_breakdown, type Stage } from './lane-breakdown'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import type { ChainEntry } from './lane-ledger-schema-ship'

// Where a lane's `josh run:chain` runs spent their time (joshuafolkken/kit#7736): each stage's runs and
// minutes over the lane's chain lines, read off the stages each line recorded. A line written before
// the stages were recorded adds none. The join's `ship` stage is left out: its time is the ship's own
// stages, which the breakdown already prints (`run-chain-join.ts`).

const LABEL = 'run:chain'
const SHIP_STAGE = 'ship'

interface StageTotal extends Stage {
	count: number
}

function is_lane_row(entry: LedgerEntry, issue: number): entry is ChainEntry {
	return entry.kind === lane_ledger.KIND.CHAIN && entry.issue === issue
}

function totals_of(rows: ReadonlyArray<ChainEntry>): Array<StageTotal> {
	const totals = new Map<string, StageTotal>()
	const stages = rows.flatMap((row) => row.stages ?? []).filter(({ name }) => name !== SHIP_STAGE)

	for (const { name, elapsed_ms } of stages) {
		const total = totals.get(name) ?? { name, ms: 0, count: 0 }

		totals.set(name, { name, ms: total.ms + elapsed_ms, count: total.count + 1 })
	}

	return [...totals.values()]
}

// The lines `josh lane:breakdown` prints under the implementation's call kinds, longest first; none
// when no run of `issue` recorded its stages.
function lines_of(entries: ReadonlyArray<LedgerEntry>, issue: number): Array<string> {
	const rows = entries.filter((entry) => is_lane_row(entry, issue))

	return totals_of(rows)
		.toSorted((first, second) => second.ms - first.ms)
		.map(
			(total) =>
				`${LABEL} › ${total.name} ×${String(total.count)} ${lane_breakdown.minutes_text(total.ms)}`,
		)
}

const lane_breakdown_chain = { lines_of }

export { lane_breakdown_chain }
