import { backlog_hold_text } from '#scripts/backlog/backlog-hold-text'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type BoardLayout, type BoardRow } from './run-board-layout'
import { run_board_setup } from './run-board-setup'

// Why a lane seat stands empty (joshuafolkken/kit#6538): one line per seat the limit allows and no lane
// holds. The first seat names the newest launch's refusal — its issue and the failing step's own words
// (`backlog-drive-launch.ts`) — until a later launch supersedes it; every other seat says whether a
// queued row could take it, read off the rows' own reasons (`run-board-reason.ts`), with the driver's
// open ledger hold. A seat a runnable row is about to take, with nothing holding the driver, draws no line.

const KIND = run_event_stream.EVENT_KIND
const { STAGE } = run_event_setup
const { WAIT_ICONS } = run_board_labels
const NO_CANDIDATE = 'no issue ready to start'
const HELD = 'held'
// A runnable row waits only for the driver a session restarts, not for a person (joshuafolkken/kit#7510).
const RESTART_PENDING = 'driver restart pending'
// The row waits that a free seat itself, or the driver's hold, answers — the row could run in the seat.
const ROOM_ICONS: ReadonlySet<string> = new Set([
	WAIT_ICONS.lane,
	WAIT_ICONS.memory,
	WAIT_ICONS.usage_limit,
])

interface SeatRead {
	// The newest launch's refusal after `no child launched`: `#<N>` and the failing step's words.
	refusal?: string | undefined
	// The ledger's open hold (`lane-held-stats.ts`); `undefined` once released.
	hold?: string | undefined
}

// What the seat lines are drawn from: the room the lanes heading counts and the rows waiting for it.
interface SeatRoom {
	seats?: SeatRead | undefined
	lane_limit?: number | undefined
	occupied_count?: number | undefined
	layout?: BoardLayout | undefined
}

function is_launch_result(event: RunEvent): boolean {
	return event.kind === KIND.CHILD_LAUNCH || run_board_setup.is_refusal(event)
}

function read_of(events: ReadonlyArray<RunEvent>, hold: string | undefined): SeatRead {
	const last = events.findLast((event) => is_launch_result(event))
	const refusal =
		last !== undefined && run_board_setup.is_refusal(last)
			? last.text.slice(STAGE.NO_CHILD.length).trim()
			: undefined

	return { refusal, hold }
}

function free_count(room: SeatRoom): number {
	const { lane_limit, occupied_count } = room

	if (lane_limit === undefined || occupied_count === undefined) return 0

	return Math.max(0, lane_limit - occupied_count)
}

// A stalled or needs-decision row is queued too, but the driver offers only a waiting one.
function is_runnable(row: BoardRow): boolean {
	if (row.state !== 'waiting' || row.waits.length > 0) return false

	return row.reason?.icon === undefined || ROOM_ICONS.has(row.reason.icon)
}

function has_candidate(layout: BoardLayout | undefined): boolean {
	return (
		layout !== undefined && run_board_layout.queued_rows(layout).some((row) => is_runnable(row))
	)
}

function with_hold(lead: string, hold: string | undefined): string {
	return hold === undefined ? lead : `${lead} — ${backlog_hold_text.text_of(hold)}`
}

// What keeps a runnable row out: the driver's absence a session restart ends, or a hold.
function held_lead(hold: string): string {
	return backlog_hold_text.is_driver_restart(hold) ? RESTART_PENDING : HELD
}

// What a seat no refusal explains says: no runnable row, or the hold that keeps a runnable one out —
// the hold as a sentence, never its ledger code (`backlog-hold-text.ts`).
function idle_reason(room: SeatRoom): string | undefined {
	const hold = room.seats?.hold

	if (!has_candidate(room.layout)) return with_hold(NO_CANDIDATE, hold)

	return hold === undefined ? undefined : with_hold(held_lead(hold), hold)
}

// No seat line where the seats are unread — before the plan is read, or once the run stopped.
function reasons_of(room: SeatRoom): Array<string> {
	if (room.seats === undefined) return []

	const idle = idle_reason(room)
	const { refusal } = room.seats
	const first = refusal === undefined ? idle : `blocked: ${refusal}`
	const reasons = Array.from({ length: free_count(room) }, (_, index) =>
		index === 0 ? first : idle,
	)

	return reasons.filter((reason) => reason !== undefined)
}

const run_board_seat = { NO_CANDIDATE, RESTART_PENDING, read_of, reasons_of }

export { run_board_seat }
export type { SeatRead, SeatRoom }
