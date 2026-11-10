import { parked_label_of } from '#scripts/issue/issue-labels'
import { issue_run_hold } from '#scripts/issue/issue-run-hold'
import { run_board_human } from './run-board-human'
import type { IdleSince } from './run-board-idle'
import type { BoardLanes } from './run-board-lane-state'
import { run_board_settle } from './run-board-settle'
import type { ItemState, ItemStatus } from './run-board-status'

// joshuafolkken/kit#6577: whether a lane's child is still working, read from one liveness source — the
// lane's process probe (`lane-spent.ts`, the header's seat count too), its lane state record and its
// transcript's result (`run_liveness.read_agent_state`). A stopped lane row keeps when it stopped, so
// its times freeze there, and why, where something recorded it.

// What ended a lane: its record's `ended` change, when and by which command.
interface LaneEnd {
	ended_ms: number
	by: string
}

// What a child's labels say, and the command that left them so.
interface LabelStop {
	state: ItemState
	reason?: string | undefined
}

// `run:release` takes `in-progress` off as it ends the run's hold (`run-hold-cli.ts`), so a child
// without it was released.
const RELEASE_REASON = 'run:release'

// A running child stopped at `ended_ms`: its phase start stays, so its phase time freezes with it.
function stopped(status: ItemStatus, ended_ms: number, reason?: string): ItemStatus {
	const { lane, phase_ms } = status

	return {
		...run_board_settle.settled_as(status, 'stopped'),
		lane,
		...(phase_ms !== undefined && { phase_ms }),
		ended_ms,
		...(reason !== undefined && { stop_reason: reason }),
	}
}

// A running lane no child is working in is stopped whatever the stream last said: a child that died or
// was closed writes no ending. A record that ended the lane dates the stop and names who ended it;
// otherwise the lane stopped by the time it was first read idle, or its transcript's last write if
// earlier — a one-shot board reads it idle only now.
function lane_status(
	status: ItemStatus,
	idle_ms: number | undefined,
	end: LaneEnd | undefined,
): ItemStatus {
	if (status.state !== 'running') return status
	if (end !== undefined) return stopped(status, end.ended_ms, end.by)

	return idle_ms === undefined
		? status
		: stopped(status, Math.min(idle_ms, status.written_ms ?? idle_ms))
}

// Each running child of `statuses` whose lane stopped, stopped: an open lane of this run's once read
// idle, or a lane this run's record ended — a closed lane is no longer open, so only its record says.
function stop_lanes(statuses: Map<number, ItemStatus>, lanes: BoardLanes, idle: IdleSince): void {
	for (const [issue, status] of statuses) {
		const idle_ms = lanes.own.has(issue) ? idle.get(String(issue)) : undefined

		statuses.set(issue, lane_status(status, idle_ms, lanes.ended?.get(issue)))
	}
}

// What a running child's labels say it is doing, `undefined` where they agree it is running: the child
// applies a human-stop label (`run-board-human.ts`) and drops `in-progress` itself when it stops, while
// the stream's park is written by a parent that may no longer be there.
function label_stop(labels: ReadonlyArray<string> | undefined): LabelStop | undefined {
	if (labels === undefined) return undefined
	if (run_board_human.is_human(labels)) return { state: 'human' }

	const parked = parked_label_of(labels)
	if (parked !== undefined) return { state: 'stopped', reason: parked }

	return issue_run_hold.is_held(labels) ? undefined : { state: 'stopped', reason: RELEASE_REASON }
}

// A child whose transcript still reads running is working, so a label that says stopped stopped its
// ship, not it: the row runs on, with the reason beside it. An unread or finished result is not taken
// for a working child.
function is_working(status: ItemStatus): boolean {
	return status.state === 'running' && status.result === 'running'
}

// A lane already stopped keeps its stop time and the reason it recorded.
function label_stopped(status: ItemStatus, reason: string | undefined): ItemStatus {
	if (status.state === 'stopped') return { ...status, stop_reason: status.stop_reason ?? reason }

	return { ...run_board_settle.settled_as(status, 'stopped'), stop_reason: reason }
}

function label_settled(status: ItemStatus, stop: LabelStop): ItemStatus {
	if (stop.state !== 'stopped') return run_board_settle.settled_as(status, stop.state)

	return is_working(status)
		? { ...status, stop_reason: stop.reason }
		: label_stopped(status, stop.reason)
}

const run_board_lane_stop = { RELEASE_REASON, label_settled, label_stop, lane_status, stop_lanes }

export { run_board_lane_stop }
export type { LaneEnd }
