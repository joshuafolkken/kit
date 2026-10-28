import { lane_check_stats } from './lane-check-stats'
import { lane_ledger, type LedgerEntry, type ShipLapEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'

// What the ship stages spent their time on (joshuafolkken/kit#5294): one period's `ship-lap` entries
// reduced to one row per stage and inner step — median, maximum and runs — printed by `josh lane:stats`
// under the stage table. The rows follow the stages' running order, a stage's steps longest first.
//
// **A row's first cell names both, `<stage>: <step>`**: `lane:value cell` finds a row by its first
// cell alone, and a stage records several steps while a step (`scoped pair`) runs in several stages.

const COLUMNS = ['ship step', 'median (min)', 'max (min)', 'runs'] as const
const STAGE_ORDER: ReadonlyArray<string> = lane_stage_stats.STAGES

interface Group {
	stage: string
	step: string
	elapsed: ReadonlyArray<number>
}

function is_ship_lap(entry: LedgerEntry): entry is ShipLapEntry {
	return entry.kind === lane_ledger.KIND.SHIP_LAP
}

function groups_of(laps: ReadonlyArray<ShipLapEntry>): Array<Group> {
	const keys = [...new Map(laps.map((lap) => [`${lap.stage}\n${lap.step}`, lap])).values()]

	return keys.map(({ stage, step }) => ({
		stage,
		step,
		elapsed: laps
			.filter((lap) => lap.stage === stage && lap.step === step)
			.map((lap) => lap.elapsed_ms),
	}))
}

// A stage `STAGES` does not name sorts after every stage it does.
function stage_rank(stage: string): number {
	const index = STAGE_ORDER.indexOf(stage)

	return index === -1 ? STAGE_ORDER.length : index
}

function compare(left: Group, right: Group): number {
	const by_stage = stage_rank(left.stage) - stage_rank(right.stage)

	if (by_stage !== 0) return by_stage

	return (lane_stats.median(right.elapsed) ?? 0) - (lane_stats.median(left.elapsed) ?? 0)
}

function row_of(group: Group): string {
	return lane_stats.to_row([
		`${group.stage}: ${group.step}`,
		lane_stage_stats.cell(lane_stats.median(group.elapsed)),
		lane_stage_stats.cell(lane_stats.peak(group.elapsed)),
		String(group.elapsed.length),
	])
}

// The period's table: `entries` is the whole ledger, filtered here to `window`.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const laps = lane_stats.in_window(entries, window).filter(is_ship_lap)
	const rows = groups_of(laps)
		.toSorted(compare)
		.map((group) => row_of(group))

	return [...lane_check_stats.header(COLUMNS), ...rows].join('\n')
}

const lane_ship_lap_stats = { table }

export { lane_ship_lap_stats }
