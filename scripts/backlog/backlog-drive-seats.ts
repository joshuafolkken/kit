import { lane_registry } from '#scripts/lane/lane-registry'
import { lane_vacant } from '#scripts/lane/lane-vacant'
import type { DrivePorts } from './backlog-drive'

type SeatPorts = Pick<DrivePorts, 'free_lanes' | 'has_lane' | 'limit_room'>

// The issues a pass launches: those that already hold a kept lane first, then the rest. A lane with no
// child in it holds no place under the limit (`backlog-occupied.ts`), so resuming its issue takes one
// (joshuafolkken/kit#4107) — but it keeps its port seat, so the resumes are cut by the limit room alone:
// idle kept lanes filling every seat must not shut out their own resumes. Fresh launches take what is
// left of both.
async function seated(issues: ReadonlyArray<string>, ports: SeatPorts): Promise<Array<string>> {
	const kept = await Promise.all(issues.map(async (issue) => await ports.has_lane(issue)))
	const room = await ports.limit_room()
	const resumed = issues.filter((_issue, index) => kept[index] === true).slice(0, room)
	const fresh_room = Math.min(await ports.free_lanes(), room - resumed.length)

	return [
		...resumed,
		...issues.filter((_issue, index) => kept[index] !== true).slice(0, fresh_room),
	]
}

// A kept lane is one a child was dispatched into that holds work — `lane:launch` reuses it rather
// than opening one. A vacant one holds nothing to resume, so its issue waits in line like any fresh
// launch (joshuafolkken/kit#4028).
async function has_kept_lane(issue: string): Promise<boolean> {
	const lane = await lane_registry.find_open_lane(issue)

	if (lane?.output === undefined) return false

	return !(await lane_vacant.is_vacant(lane))
}

const backlog_drive_seats = { has_kept_lane, seated }

export { backlog_drive_seats }
