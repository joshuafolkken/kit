import type { LaneInfo } from '#scripts/lane/lane-registry'
import type { LaneRecords } from '#scripts/lane/lane-state'

// The open lanes that hold a place under the lane limit — the one count `lane:limit`, the drive and
// `run:board` all subtract from it.
//
// **A lane with no child working in it holds no place, whatever it waits on** (joshuafolkken/kit#4107).
// The limit caps the load on the machine, and a lane whose child is gone puts none on it — parked,
// blocked by another issue, waiting on a decision, or left by an earlier run (joshuafolkken/kit#3967,
// #4028). Its tree, branch and port seat stay; when its issue is picked up again the drive seats it
// ahead of a fresh launch, inside the free lanes (`backlog-drive-seats.ts`).
//
// **A paused lane holds no place either** (joshuafolkken/kit#4201): a child `lane:pause` suspended
// puts no load on the machine until it is resumed. **Paused is the lane state record's answer alone**
// (joshuafolkken/kit#4270) — the `ps` state is not read — so a lane only `lane:pause` paused is
// uncounted. Its memory stays held, which the free-memory check reads as measured
// (`backlog-drive-memory.ts`); `lane:prune` still keeps it, since a child is there (`lane-spent.ts`).
//
// **A lane with no record is unknown, and keeps its place**, so the count errs toward fewer free
// lanes. **Whether a child is there at all is not the record's**:
// a child that parks or dies writes nothing, so only pgrep's own "no match" (`PROCESS_NONE`,
// `lane_spent.idle_lanes`) clears a lane, and a probe that did not answer keeps it. A stranded lane has
// no tree to work in and holds no place either. The reads stay local — no issue label is read —
// because the count gates the network read behind it (`backlog-ready.ts`).
//
// **A lane whose detached ship waits on its merge holds no place either** (joshuafolkken/kit#4466). The
// child ended at the hand-off, and while `josh followup` runs the supervisor only polls CI, CodeRabbit
// and the merge, so the slot is free for the next launch while every merge check still runs. The wait is
// unmarked while the followup stage merges and gates again (`run-ship-sync.ts`); a stop there counts
// the lane again, and more than one lane past the limit the supervisor waits for a place before it
// relaunches the child (`run-ship-place.ts`). A named epic's offer discounts the same lanes (`epic-lane-offer.ts`).

// The issues whose lane has no child working in it (`lane_spent.idle_lanes`).
type IdleRead = (lanes: ReadonlyArray<LaneInfo>) => ReadonlyArray<string>
// Whether the lane of an issue has a detached ship waiting on its merge (`lane_handoff.merge_wait_reader`).
type MergeWaitRead = (issue: string) => boolean

function is_never_merge_waiting(): boolean {
	return false
}

function occupied_lanes(
	lanes: ReadonlyArray<LaneInfo>,
	idle: IdleRead,
	records: LaneRecords,
	is_merge_waiting: MergeWaitRead = is_never_merge_waiting,
): Array<LaneInfo> {
	const live = lanes.filter((lane) => !lane.is_stranded)
	const idle_issues = new Set(idle(live))

	return live.filter(
		(lane) =>
			!idle_issues.has(lane.issue) &&
			records.get(lane.issue)?.state !== 'paused' &&
			!is_merge_waiting(lane.issue),
	)
}

/** The issues of the live lanes in `lanes` that have no state record. */
function unknown_lanes(lanes: ReadonlyArray<LaneInfo>, records: LaneRecords): Array<string> {
	return lanes
		.filter((lane) => !lane.is_stranded && !records.has(lane.issue))
		.map((lane) => lane.issue)
}

const backlog_occupied = { occupied_lanes, unknown_lanes }

export { backlog_occupied }
export type { IdleRead, MergeWaitRead }
