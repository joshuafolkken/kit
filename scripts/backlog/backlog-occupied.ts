import type { LaneInfo } from '#scripts/lane/lane-registry'

// The open lanes that hold a place under the lane limit — the one count `lane:limit`, the drive and
// `run:board` all subtract from it.
//
// **A lane with no child working in it holds no place, whatever it waits on** (joshuafolkken/kit#4107).
// The limit caps the load on the machine, and a lane whose child is gone puts none on it — parked,
// blocked by another issue, waiting on a decision, or left by an earlier run (joshuafolkken/kit#3967,
// #4028). Its tree, branch and port seat stay; when its issue is picked up again the drive seats it
// ahead of a fresh launch, inside the free lanes (`backlog-drive-seats.ts`).
//
// **A lane whose probe did not answer keeps its place, so the count errs toward fewer free lanes**:
// only pgrep's own "no match" (`PROCESS_NONE`, `lane_spent.idle_lanes`) clears one. A stranded lane
// has no tree to work in and holds no place either. The read stays local — no issue label is read —
// because the count gates the network read behind it (`backlog-ready.ts`).

// The issues whose lane has no child working in it (`lane_spent.idle_lanes`).
type IdleRead = (lanes: ReadonlyArray<LaneInfo>) => ReadonlyArray<string>

function occupied_lanes(lanes: ReadonlyArray<LaneInfo>, idle: IdleRead): Array<LaneInfo> {
	const live = lanes.filter((lane) => !lane.is_stranded)
	const idle_issues = new Set(idle(live))

	return live.filter((lane) => !idle_issues.has(lane.issue))
}

const backlog_occupied = { occupied_lanes }

export { backlog_occupied }
export type { IdleRead }
