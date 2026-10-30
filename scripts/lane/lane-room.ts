import { backlog_occupied } from '#scripts/backlog/backlog-occupied'
import { lane_capacity } from './lane-capacity'
import { lane_process_table, type TableRead } from './lane-process-table'
import { lane_registry, type LaneInfo } from './lane-registry'
import { lane_snapshot_trace } from './lane-snapshot-trace'
import { lane_spent } from './lane-spent'
import { lane_state } from './lane-state'

interface LaneUse {
	occupied: number
	seated: number
	unknown: ReadonlyArray<string>
}

interface LaneRoom {
	occupied: ReadonlyArray<LaneInfo>
	idle: ReadonlyArray<string>
	unknown: ReadonlyArray<string>
	use: LaneUse
}

// One process snapshot supplies execution occupancy, idle lanes and merge waits for every caller.
async function occupancy_of(
	open: ReadonlyArray<LaneInfo>,
	table: TableRead,
): Promise<Omit<LaneRoom, 'use'>> {
	const rows = await table()
	const issues = open.map((lane) => lane.issue)
	const trace = { process_trace: await lane_snapshot_trace.traces_of(issues, rows) }
	const records = await lane_state.read_states(issues)
	const is_merge_waiting = await lane_snapshot_trace.merge_waits_of(issues, rows)
	const occupied = backlog_occupied.occupied_lanes(
		open,
		(live) => lane_spent.idle_lanes(live, trace),
		records,
		is_merge_waiting,
	)
	const unknown = backlog_occupied.unknown_lanes(open, records)

	return { occupied, idle: lane_spent.idle_lanes(open, trace), unknown }
}

// Execution places and port ownership are independent; a saved tree alone occupies neither seat.
async function read(
	lanes?: ReadonlyArray<LaneInfo>,
	table: TableRead = lane_process_table.read_table,
): Promise<LaneRoom> {
	const open = lanes ?? (await lane_registry.list_lanes())
	const occupancy = await occupancy_of(open, table)
	const seated =
		lane_registry.unreadable_lanes(open).length > 0
			? lane_capacity.seated_limit(Infinity)
			: lane_registry.used_seats(open).length
	const use = { occupied: occupancy.occupied.length, seated, unknown: occupancy.unknown }

	return { ...occupancy, use }
}

const lane_room = { read }

export { lane_room }
export type { LaneRoom, LaneUse }
