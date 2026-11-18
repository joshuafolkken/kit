import { MS_PER_MINUTE, MS_PER_SECOND } from '#scripts/lib/timeouts'
import type { LocalRead } from './run-board-read'
import type { BoardState } from './run-board-state'
import { run_board_status, type ItemState } from './run-board-status'

// Which children a `run:board` closed read asks about once its run has ended.

// A child waiting on a person, drawn in 🙋 decision until a closed read settles it, or waiting on its
// retry, which a person may close before it runs again (joshuafolkken/kit#7900).
const { CLOSE_WAITING_STATES } = run_board_status
const ALWAYS_ASKED_STATES: ReadonlySet<ItemState> = new Set(['stopped', ...CLOSE_WAITING_STATES])
// A child that merged itself is drawn stopped until GitHub answers it closed, and the answer can lag
// the merge by minutes (joshuafolkken/kit#7556). The board stays open between runs, so a stopped child
// that never closes stops being asked about this long after the run ended — several retry intervals,
// well past the lag of a merge that already happened.
const STOPPED_ASK_MINUTES = 15
const STOPPED_ASK_LIMIT_MS = STOPPED_ASK_MINUTES * MS_PER_MINUTE
// The first closed read after a lane ends often lands before GitHub shows the merge, which kept the
// child drawn 🛑 a whole retry interval (joshuafolkken/kit#7557). While a child the read asks about ended
// its lane within the window, the read is asked again this often. Rate limit: one lane end adds at most
// window ÷ retry (8) closed reads, each one read of the children still unanswered.
const FRESH_END_WINDOW_SECONDS = 120
const FRESH_RETRY_SECONDS = 15
const FRESH_END_WINDOW_MS = FRESH_END_WINDOW_SECONDS * MS_PER_SECOND
const FRESH_RETRY_MS = FRESH_RETRY_SECONDS * MS_PER_SECOND
// Only a closed lane is about to merge; a withdrawn one never closes its Issue.
const CLOSING_END = 'lane:close'

function has_asked_since_end(state: BoardState, ended_ms: number | undefined): boolean {
	const { closed_answered_ms } = state
	if (closed_answered_ms === undefined || ended_ms === undefined) return false

	return closed_answered_ms >= ended_ms
}

// An ended run asks as a going run does until one ask after it ended has answered whole. After that it
// asks only about a child drawn stopped, until the limit, or waiting on a person or its retry — a
// person closing it is what the board waits to draw. `undefined` while the run still asks as a going
// run does.
function ended_asked_states(
	state: BoardState,
	local: LocalRead,
	now_ms: number,
): ReadonlySet<ItemState> | undefined {
	const { ended_ms } = local
	if (ended_ms === undefined || !has_asked_since_end(state, ended_ms)) return undefined

	return now_ms - ended_ms <= STOPPED_ASK_LIMIT_MS ? ALWAYS_ASKED_STATES : CLOSE_WAITING_STATES
}

function is_fresh_end(local: LocalRead, issue: number, now_ms: number): boolean {
	const end = local.lane_states.ended?.get(issue)

	return end?.by === CLOSING_END && now_ms - end.ended_ms <= FRESH_END_WINDOW_MS
}

// How long after the last closed read the next is due: sooner while a child it asks about has just had
// its lane ended by its record, else `usual_ms`.
function closed_retry_ms(
	local: LocalRead,
	unread: ReadonlyArray<number>,
	now_ms: number,
	usual_ms: number,
): number {
	return unread.some((issue) => is_fresh_end(local, issue, now_ms)) ? FRESH_RETRY_MS : usual_ms
}

const run_board_closed_pace = {
	ALWAYS_ASKED_STATES,
	FRESH_END_WINDOW_MS,
	FRESH_RETRY_MS,
	STOPPED_ASK_LIMIT_MS,
	closed_retry_ms,
	ended_asked_states,
}

export { run_board_closed_pace }
