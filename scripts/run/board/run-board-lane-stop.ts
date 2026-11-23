import { parked_label_of } from '#scripts/issue/issue-labels'
import { issue_run_hold } from '#scripts/issue/issue-run-hold'
import type { ResumeWaits } from '#scripts/run/event/run-resume-wait'
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

// joshuafolkken/kit#7750: a child without `in-progress` is drawn by that fact, not by a command
// guessed to have taken it off — `run:release`, `run:merge`, `run:stale` and a person all do.
const UNLABELLED_REASON = 'no in-progress label'

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

// joshuafolkken/kit#7694: a lane closed before the row's run started is an earlier child's ending — a
// run handed off in the main tree on the same issue is not stopped by it.
function ending_of(end: LaneEnd | undefined, status: ItemStatus): LaneEnd | undefined {
	if (end === undefined || status.started_ms === undefined) return end

	return end.ended_ms < status.started_ms ? undefined : end
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
	const ending = ending_of(end, status)
	if (ending !== undefined) return stopped(status, ending.ended_ms, ending.by)

	return idle_ms === undefined
		? status
		: stopped(status, Math.min(idle_ms, status.written_ms ?? idle_ms))
}

// joshuafolkken/kit#7750: an open lane of this run's not yet read idle for the re-confirm window is not
// confirmed stopped (`lane-spent.ts`), so it stays running and says so — not a positive alive read.
function own_status(
	issue: number,
	status: ItemStatus,
	lanes: BoardLanes,
	idle: IdleSince,
): ItemStatus {
	const end = lanes.ended?.get(issue)
	if (!lanes.own.has(issue)) return lane_status(status, undefined, end)
	const settled = lane_status(status, idle.get(String(issue)), end)

	return settled.state === 'running' ? { ...settled, is_live: true } : settled
}

// joshuafolkken/kit#8855: a stopped child an outage left awaiting a restart says why it is not
// restarted yet (`run-resume-wait.ts`), in its own field so the label-derived stop reason still settles.
function waited(status: ItemStatus, wait: string | undefined): ItemStatus {
	if (wait === undefined || status.state !== 'stopped') return status

	return { ...status, resume_wait: wait }
}

// Each running child of `statuses` whose lane stopped, stopped: an open lane of this run's once read
// idle, or a lane this run's record ended — a closed lane is no longer open, so only its record says.
function stop_lanes(
	statuses: Map<number, ItemStatus>,
	lanes: BoardLanes,
	idle: IdleSince,
	waits: ResumeWaits,
): void {
	for (const [issue, status] of statuses) {
		const settled = own_status(issue, status, lanes, idle)
		const wait = waits.get(String(issue))

		statuses.set(issue, waited(settled, wait))
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

	return issue_run_hold.is_held(labels)
		? undefined
		: { state: 'stopped', reason: UNLABELLED_REASON }
}

// A child whose transcript still reads running is working, so a label that says stopped stopped its
// ship, not it: the row runs on, with the reason beside it. An unread or finished result is not taken
// for a working child; a lane not confirmed idle is, where only its `in-progress` is missing.
function is_working(status: ItemStatus, stop: LabelStop): boolean {
	if (status.state !== 'running') return false

	return (
		status.result === 'running' || (status.is_live === true && stop.reason === UNLABELLED_REASON)
	)
}

// A lane already stopped keeps its stop time and the reason it recorded.
function label_stopped(status: ItemStatus, reason: string | undefined): ItemStatus {
	if (status.state === 'stopped') return { ...status, stop_reason: status.stop_reason ?? reason }

	return { ...run_board_settle.settled_as(status, 'stopped'), stop_reason: reason }
}

function label_settled(status: ItemStatus, stop: LabelStop): ItemStatus {
	if (stop.state !== 'stopped') return run_board_settle.settled_as(status, stop.state)

	return is_working(status, stop)
		? { ...status, stop_reason: stop.reason }
		: label_stopped(status, stop.reason)
}

// What the read labels of a child read after its launch settle it as; `undefined` labels leave it.
function labels_settled(status: ItemStatus, labels: ReadonlyArray<string> | undefined): ItemStatus {
	const stop = label_stop(labels)

	return stop === undefined ? status : label_settled(status, stop)
}

const run_board_lane_stop = {
	UNLABELLED_REASON,
	label_settled,
	label_stop,
	labels_settled,
	lane_status,
	stop_lanes,
}

export { run_board_lane_stop }
export type { LaneEnd }
