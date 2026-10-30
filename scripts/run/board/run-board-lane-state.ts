import type { LaneStateRecord } from '#scripts/lane/lane-state'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_board_status, type ItemStatus } from './run-board-status'

// What each open lane is doing on `run:board`, read from its lane state record (joshuafolkken/kit#4269)
// rather than guessed from the run's span, the `.env` mtime or the `ps` state.
//
// **Whose lane it is is the record's**: a lane is this run's when the run that launched it started
// when this run did, whatever the stream says, so a cut, a resume or an ending an earlier run's child
// writes inside this run's span never makes it this run's. **What it is doing is the record's too** —
// running or paused — and its time counts from the record's newest launch. The phase and the newest
// activity are the stream's, folded from the lane's newest launch on. A lane with no record is not
// guessed at: it is drawn unknown.

interface BoardLanes {
	// This run's lanes, by issue, with what each is doing.
	own: ReadonlyMap<number, ItemStatus>
	// An earlier run's lanes, likewise — drawn apart, never counted as this run's.
	earlier: ReadonlyMap<number, ItemStatus>
	// The open lanes with no record.
	unknown: ReadonlyArray<string>
}

const NO_LANES: BoardLanes = { own: new Map(), earlier: new Map(), unknown: [] }

// The record states a lane holds a child in; an `open` lane has launched none yet, an `ended` one is
// done with its child, and neither draws a row of its own.
const HUMAN_REVIEW = 'human-review'
const HELD_STATES: ReadonlySet<string> = new Set(['running', 'paused', HUMAN_REVIEW])

function time_of(at: string | undefined): number | undefined {
	return at === undefined ? undefined : Date.parse(at)
}

// A record the one-off migration wrote (joshuafolkken/kit#4268) names no run, so its launch is placed against this run's start.
function is_own(record: LaneStateRecord, started_ms: number): boolean {
	if (record.run === undefined) return (time_of(record.launched_at) ?? NaN) >= started_ms

	return time_of(record.run.started_at) === started_ms
}

// What the record says of the lane: running, or paused since the record last changed, by the command
// that paused it.
function recorded(record: LaneStateRecord, folded: ItemStatus | undefined): ItemStatus {
	const started_ms = time_of(record.launched_at) ?? folded?.started_ms
	const lane = `lane ${record.issue}`

	if (record.state === HUMAN_REVIEW) {
		return { ...folded, state: 'human', started_ms, ended_ms: time_of(record.changed_at), lane }
	}

	if (record.state === 'paused') {
		const ended_ms = time_of(record.changed_at)

		return { ...folded, state: 'paused', started_ms, ended_ms, lane, paused_by: record.changed_by }
	}

	return { ...folded, state: 'running', started_ms, lane }
}

// The lane's status: its events from the record's newest launch on, folded over the record's running
// child, so a cut or a stage line whose launch rolled off the stream carries it on. An ending among
// them stands; otherwise the record's state does.
function status_of(events: ReadonlyArray<RunEvent>, record: LaneStateRecord): ItemStatus {
	const issue = Number(record.issue)
	const launched_ms = time_of(record.launched_at)
	const launched = run_board_status.since_launch(events, record.issue, launched_ms)
	const seed: ReadonlyMap<number, ItemStatus> = new Map([
		[issue, { state: 'running', started_ms: launched_ms }],
	])
	const folded = run_board_status.fold_events(launched, seed).get(issue)

	return folded === undefined || folded.state === 'running' ? recorded(record, folded) : folded
}

interface LaneRead {
	// The whole stream, not the run's span: an earlier run's lane launched before the span began.
	events: ReadonlyArray<RunEvent>
	lanes: ReadonlyArray<string>
	records: ReadonlyMap<string, LaneStateRecord>
	started_ms: number
}

function place(read: LaneRead, lane: string, sorted: BoardLanes): BoardLanes {
	const record = read.records.get(lane)

	if (record === undefined) return { ...sorted, unknown: [...sorted.unknown, lane] }
	if (!HELD_STATES.has(record.state)) return sorted

	const entry = [Number(lane), status_of(read.events, record)] as const

	return is_own(record, read.started_ms)
		? { ...sorted, own: new Map([...sorted.own, entry]) }
		: { ...sorted, earlier: new Map([...sorted.earlier, entry]) }
}

// Each open lane sorted by its record into this run's, an earlier run's or unknown.
function lanes_of(read: LaneRead): BoardLanes {
	let sorted = NO_LANES

	for (const lane of read.lanes) sorted = place(read, lane, sorted)

	return sorted
}

// An earlier run's lane is drawn only while it holds a place under the limit.
function earlier_occupied(occupied: ReadonlyArray<string>, sorted: BoardLanes): Array<string> {
	return occupied.filter((issue) => sorted.earlier.has(Number(issue)))
}

const run_board_lane_state = { NO_LANES, earlier_occupied, lanes_of }

export { run_board_lane_state }
export type { BoardLanes, LaneRead }
