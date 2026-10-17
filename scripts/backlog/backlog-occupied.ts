import type { LaneInfo } from '#scripts/lane/lane-registry'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_invocation } from '#scripts/run/run-invocation'
import { backlog_drive_restore } from './backlog-drive-restore'

// The open lanes that hold a place under the lane limit — the one count `lane:limit`, the drive and
// `run:board` all subtract from it.
//
// **A lane nobody will come back to holds no place.** A `--only` run works its named list and never
// touches another lane, so a lane an earlier run left with no child in it would fill the limit for the
// whole run, and the run's own issues would wait on it for good (joshuafolkken/kit#3967). Under a `--only`
// run such a lane is not counted; its tree and branch stay, for the next run that names its issue.
//
// **A vacant lane holds no place under any run** (joshuafolkken/kit#4028): a lane with no commit, a
// clean tree and no child (`lane-vacant.ts`) is what a child that ended doing nothing leaves, and it
// filled the limit while a drain run's issues waited. It keeps its port seat, and `lane:launch` closes
// and reopens it when its issue is offered again.
//
// **Everything else keeps its place, so the count errs toward fewer free lanes.** A run that drains
// the pool may offer any open lane's issue again, a lane whose child still works is busy whoever owns
// it, and with no run there is nobody to judge ownership for. The read stays local — no issue label is
// read — because the count gates the network read behind it (`backlog-ready.ts`).

interface OccupiedRead {
	// The live run's invocation, `undefined` when no run is live here.
	invocation: string | undefined
	// The live run's own events, for the issues it launched or settled; `undefined` where its scope
	// could not be told, which leaves every open lane counted.
	events: ReadonlyArray<RunEvent> | undefined
	// The issues whose lane has no child working in it; read only for a `--only` run.
	idle: (lanes: ReadonlyArray<LaneInfo>) => ReadonlyArray<string>
	// The issues whose lane holds nothing worth keeping (`lane_vacant.vacant_issues`).
	vacant: (lanes: ReadonlyArray<LaneInfo>) => Promise<ReadonlyArray<string>>
}

// The issues a `--only` run owns — those it names and those it launched or settled — or `undefined`
// where there is no such run, or its events could not be scoped to it.
function owned_issues(read: OccupiedRead): ReadonlySet<string> | undefined {
	const { invocation, events } = read
	const is_only = invocation !== undefined && run_invocation.has_only(invocation)

	if (!is_only || events === undefined) return undefined

	const named = (run_invocation.issue_numbers(invocation) ?? []).map(String)

	return new Set([...named, ...backlog_drive_restore.mentioned_issues(events)])
}

async function held_lanes(
	lanes: ReadonlyArray<LaneInfo>,
	read: OccupiedRead,
): Promise<Array<LaneInfo>> {
	const live = lanes.filter((lane) => !lane.is_stranded)
	const vacant = new Set(await read.vacant(live))

	return live.filter((lane) => !vacant.has(lane.issue))
}

async function occupied_lanes(
	lanes: ReadonlyArray<LaneInfo>,
	read: OccupiedRead,
): Promise<Array<LaneInfo>> {
	const held = await held_lanes(lanes, read)
	const owned = owned_issues(read)

	if (owned === undefined) return held

	const idle = new Set(read.idle(held))

	return held.filter((lane) => owned.has(lane.issue) || !idle.has(lane.issue))
}

const backlog_occupied = { occupied_lanes }

export { backlog_occupied }
export type { OccupiedRead }
