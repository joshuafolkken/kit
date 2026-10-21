import { lane_ledger, type CoreWaitEntry, type LedgerEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'

// How long each lane's commands waited for the core budget: the ledger's `core-wait` entries of one
// period reduced to one row per lane, printed by `josh lane:stats` so a lane's time splits into work
// and waiting (joshuafolkken/kit#4382). A lane is named by its issue number, a wait outside a lane — the
// main checkout's — by its own row.

const COLUMNS = ['lane', 'total (min)', 'median (min)', 'waits'] as const
const OUTSIDE_A_LANE = 'outside a lane'
const { NOT_MEASURED } = lane_stage_stats
// A period with no wait: the table still prints, so a reader sees zero waits rather than no table.
const NONE_ROW = ['none', NOT_MEASURED, NOT_MEASURED, '0']

function is_core_wait(entry: LedgerEntry): entry is CoreWaitEntry {
	return entry.kind === lane_ledger.KIND.CORE_WAIT
}

function lane_of(wait: CoreWaitEntry): string {
	return wait.issue === undefined ? OUTSIDE_A_LANE : String(wait.issue)
}

function total(values: ReadonlyArray<number>): number {
	return values.reduce((sum, value) => sum + value, 0)
}

function waits_of(waits: ReadonlyArray<CoreWaitEntry>, lane: string): Array<number> {
	return waits.filter((wait) => lane_of(wait) === lane).map((wait) => wait.waited_ms)
}

function lane_row(lane: string, waits: ReadonlyArray<CoreWaitEntry>): string {
	const waited = waits_of(waits, lane)

	return lane_stats.to_row([
		lane,
		lane_stage_stats.cell(total(waited)),
		lane_stage_stats.cell(lane_stats.median(waited)),
		String(waited.length),
	])
}

// The lanes the period saw, the longest total first, so the lane the budget held back most leads.
function lanes_of(waits: ReadonlyArray<CoreWaitEntry>): Array<string> {
	const lanes = [...new Set(waits.map((wait) => lane_of(wait)))]

	return lanes.toSorted(
		(left, right) => total(waits_of(waits, right)) - total(waits_of(waits, left)),
	)
}

// The period's table: `entries` is the whole ledger, filtered here to `window`.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const waits = lane_stats.in_window(entries, window).filter((entry) => is_core_wait(entry))
	const rows = lanes_of(waits).map((lane) => lane_row(lane, waits))

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...(rows.length === 0 ? [lane_stats.to_row(NONE_ROW)] : rows),
	].join('\n')
}

const lane_core_wait_stats = { table }

export { lane_core_wait_stats }
