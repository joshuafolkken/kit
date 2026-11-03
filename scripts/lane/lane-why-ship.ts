import { run_ship_lap } from '#scripts/run/ship/run-ship-lap'
import { lane_breakdown, type Breakdown, type Stage } from './lane-breakdown'
import { lane_breakdown_laps } from './lane-breakdown-laps'
import { lane_breakdown_related } from './lane-breakdown-related'
import { lane_stats } from './lane-stats'
import type { WhyRecords } from './lane-why'

// `josh lane:why`'s ship total (joshuafolkken/kit#6154): the scoped pair's runs and minutes, the
// core-budget waits and the `test:related` cap overrun summed over the whole ship, so stages each
// within their budget that add up past the lane's target still show. A missing record leaves its
// cell blank.

const COLUMNS = ['ship total', 'scoped pair', 'core-budget wait', 'test:related']
const BLANK = ''
const { SCOPED_PAIR } = run_ship_lap.STEP

type ShipRecords = Pick<WhyRecords, 'entries' | 'issue' | 'breakdown'>

// A scoped pair lap carries its notes after the step's name (`lane-breakdown-laps.ts`).
function is_scoped_pair(part: Stage): boolean {
	return part.name === SCOPED_PAIR || part.name.startsWith(`${SCOPED_PAIR} (`)
}

function sum_ms(parts: ReadonlyArray<Stage>): number {
	return parts.reduce((total, part) => total + part.ms, 0)
}

function scoped_pair_cell(parts: ReadonlyArray<Stage>): string {
	const runs = parts.filter((part) => is_scoped_pair(part))

	if (runs.length === 0) return BLANK

	const noun = runs.length === 1 ? 'run' : 'runs'

	return `${String(runs.length)} ${noun}, ${lane_breakdown.minutes_text(sum_ms(runs))}`
}

function core_wait_cell(parts: ReadonlyArray<Stage>): string {
	const waits = parts.filter((part) => part.name === lane_breakdown_laps.CORE_WAIT_STEP)

	return waits.length === 0 ? BLANK : lane_breakdown.minutes_text(sum_ms(waits))
}

// The ship stages and the time between them, waits left in, as `lane:breakdown` cut them.
function ship_ms(breakdown: Breakdown): number {
	return breakdown.ship.reduce((total, segment) => total + segment.to_ms - segment.from_ms, 0)
}

// The ship total of the lane as a one-row table.
function table({ entries, issue, breakdown }: ShipRecords): string {
	const parts = lane_breakdown_laps.ship_parts(entries, issue, breakdown)
	const in_ship = entries.filter((entry) => lane_breakdown_laps.is_in_ship(breakdown, entry.at))
	const row = [
		lane_breakdown.minutes_text(ship_ms(breakdown)),
		scoped_pair_cell(parts),
		core_wait_cell(parts),
		lane_breakdown_related.over_cap_text(in_ship, issue),
	]

	return [COLUMNS, COLUMNS.map(() => '---'), row]
		.map((cells) => lane_stats.to_row(cells))
		.join('\n')
}

const lane_why_ship = { table }

export { lane_why_ship }
