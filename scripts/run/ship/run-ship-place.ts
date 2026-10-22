import { setTimeout as sleep } from 'node:timers/promises'
import { backlog_ready } from '#scripts/backlog/backlog-ready'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { lane_capacity } from '#scripts/lane/lane-capacity'
import { lane_handoff } from '#scripts/lane/lane-handoff'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { run_ship_stage, type Stage } from './run-ship-stage'

// **A followup stop past the lane limit waits for a place, then relaunches**: its lane held no place
// while it waited (`backlog-occupied.ts`), so the next launch may have taken it, and a child started at
// once would run past the limit (joshuafolkken/kit#4466). The stopped lane counts again while this
// supervisor waits, so the driver launches nothing into the place it waits for. An unreadable limit or
// lane count relaunches at once, and so does a place that does not free within the wait.
//
// **Waiters queue in issue order rather than block each other**: every waiter counts in the lane use,
// so three of them past a limit of two would each see the lanes full and wait out the hour together. A
// waiter leaves out the waiters behind it, so the first ones that fit relaunch and the rest wait on them.
// The mark is the ship stage record's (`run_ship_stage.mark_place_waiting`), read only while the ship
// runs, so a dead supervisor's mark queues nobody.

// An hour of lane counts, half a minute apart: about two lanes' median run (`lane:stats`).
const PLACE_POLL_MS = 30_000
const PLACE_POLLS = 120

function is_behind(lane: LaneInfo, issue: string): boolean {
	return lane.issue.localeCompare(issue, undefined, { numeric: true }) > 0
}

async function waiters_behind(issue: string): Promise<number> {
	const lanes = await lane_registry.list_lanes()

	return lanes.filter(
		(lane) => is_behind(lane, issue) && lane_handoff.is_place_waiting(lane.issue, lane.directory),
	).length
}

async function is_over_limit(issue: string): Promise<boolean> {
	const limit = await lane_capacity.lane_limit()

	if (limit.kind !== 'limit') return false

	const use = await backlog_ready.lane_use()
	const behind = await waiters_behind(issue)

	return use.occupied - behind > lane_capacity.seated_limit(limit.limit)
}

async function is_place_taken(issue: string): Promise<boolean> {
	try {
		return await is_over_limit(issue)
	} catch {
		return false
	}
}

// Best-effort: a mark that could not be written leaves this waiter counted by the others, as before.
function mark(lane: LaneInfo, is_waiting: boolean): void {
	const repository = git_common_directory.repository(lane.directory)

	if (repository === undefined) return

	try {
		run_ship_stage.mark_place_waiting(
			run_ship_stage.record_path(repository, lane.issue),
			is_waiting,
		)
	} catch {
		// The queue only orders waiters; an unmarked one still waits on the lane count.
	}
}

async function poll(issue: string): Promise<void> {
	for (let polled = 0; polled < PLACE_POLLS; polled += 1) {
		// eslint-disable-next-line no-await-in-loop -- polling: each check waits on a lane the previous one saw busy
		if (!(await is_place_taken(issue))) return

		// eslint-disable-next-line no-await-in-loop -- polling: the wait between two lane counts
		await sleep(PLACE_POLL_MS)
	}
}

async function await_place(lane: LaneInfo, stage: Stage): Promise<void> {
	if (stage !== run_ship_stage.STAGE.FOLLOWUP) return

	mark(lane, true)

	try {
		await poll(lane.issue)
	} finally {
		mark(lane, false)
	}
}

const run_ship_place = { await_place }

export { run_ship_place }
