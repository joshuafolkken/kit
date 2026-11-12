import type { OpenIssueData } from '#scripts/git/git-schemas'
import { has_any_label, RUN_SOLO_LABEL } from '#scripts/issue/issue-labels'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_room, type LaneRoom, type LaneUse } from '#scripts/lane/lane-room'
import type { BusyRead } from './epic-busy'

interface OccupancyRead {
	read: BusyRead
	use?: LaneUse
}

const SOLO_LABELS: ReadonlySet<string> = new Set([RUN_SOLO_LABEL])

function is_local(issue: OpenIssueData, lanes: ReadonlyArray<LaneInfo>): boolean {
	return lanes.some((lane) => lane.issue === String(issue.number))
}

// Unknown state or seat ownership is never evidence that a labelled holder stopped.
function confirmed_stopped(lanes: ReadonlyArray<LaneInfo>, room: LaneRoom): ReadonlySet<string> {
	const occupied = new Set(room.occupied.map((lane) => lane.issue))

	return new Set(
		lanes
			.filter((lane) => !lane.seat_held && lane.seat_problem === undefined)
			.map((lane) => lane.issue)
			.filter(
				(issue) =>
					room.idle.includes(issue) && !room.unknown.includes(issue) && !occupied.has(issue),
			),
	)
}

function reconcile(
	issues: ReadonlyArray<OpenIssueData>,
	lanes: ReadonlyArray<LaneInfo>,
	room: LaneRoom,
): OccupancyRead {
	const stopped = confirmed_stopped(lanes, room)
	// Only epic_solo_stale's reconfirmed release may drop a solo holder across a cut.
	const holders = issues.filter(
		(issue) => has_any_label(issue.labels, SOLO_LABELS) || !stopped.has(String(issue.number)),
	)
	const remote = holders.filter((issue) => !is_local(issue, lanes)).length
	const occupied = new Set(room.occupied.map((lane) => lane.issue))
	const unknown = holders.filter(
		(issue) => room.unknown.includes(String(issue.number)) && !occupied.has(String(issue.number)),
	).length
	const use = {
		...room.use,
		occupied: room.use.occupied + remote + unknown,
		seated: room.use.seated + remote,
	}

	return { read: holders.length > 0 ? { kind: 'busy', issues: holders } : { kind: 'idle' }, use }
}

// Reuse the board/drive snapshot only for this repository's locally registered holders.
// Unseen machines and failed local reads retain the label-based conservative answer.
async function read(reading: BusyRead, is_this_checkout: boolean): Promise<OccupancyRead> {
	if (!is_this_checkout || reading.kind !== 'busy') return { read: reading }

	try {
		const lanes = await lane_registry.list_lanes()
		if (reading.issues.every((issue) => !is_local(issue, lanes))) return { read: reading }

		return reconcile(reading.issues, lanes, await lane_room.read(lanes))
	} catch {
		return { read: reading }
	}
}

const epic_lane_occupancy = { read }

export { epic_lane_occupancy }
export type { OccupancyRead }
