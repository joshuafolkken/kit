import { lane_registry } from '#scripts/lane/lane-registry'
import type { DrivePorts } from './backlog-drive'

type SeatPorts = Pick<DrivePorts, 'free_lanes' | 'has_lane'>

// The issues a pass launches: every one that already holds a kept lane, which it reuses, then as many
// of the rest as there are free lanes.
async function seated(issues: ReadonlyArray<string>, ports: SeatPorts): Promise<Array<string>> {
	const kept = await Promise.all(issues.map(async (issue) => await ports.has_lane(issue)))
	const fresh = issues.filter((_issue, index) => kept[index] !== true)

	return [
		...issues.filter((_issue, index) => kept[index] === true),
		...fresh.slice(0, await ports.free_lanes()),
	]
}

// A kept lane is one a child was dispatched into — `lane:launch` reuses it rather than opening one.
async function has_kept_lane(issue: string): Promise<boolean> {
	const lane = await lane_registry.find_open_lane(issue)

	return lane?.output !== undefined
}

const backlog_drive_seats = { has_kept_lane, seated }

export { backlog_drive_seats }
