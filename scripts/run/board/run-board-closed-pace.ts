import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import type { LocalRead } from './run-board-read'
import type { BoardState } from './run-board-state'
import { run_board_status, type ItemState } from './run-board-status'

// Which children a `run:board` closed read asks about once its run has ended.

// A child waiting on a person, drawn in 🙋 decision until a closed read settles it.
const { WAITING_STATES } = run_board_status
const STOPPED_STATE: ItemState = 'stopped'
const ALWAYS_ASKED_STATES: ReadonlySet<ItemState> = new Set([STOPPED_STATE, ...WAITING_STATES])
// A child that merged itself is drawn stopped until GitHub answers it closed, and the answer can lag
// the merge by minutes (joshuafolkken/kit#7556). The board stays open between runs, so a stopped child
// that never closes stops being asked about this long after the run ended — several retry intervals,
// well past the lag of a merge that already happened.
const STOPPED_ASK_MINUTES = 15
const STOPPED_ASK_LIMIT_MS = STOPPED_ASK_MINUTES * MS_PER_MINUTE

function has_asked_since_end(state: BoardState, ended_ms: number | undefined): boolean {
	const { closed_answered_ms } = state
	if (closed_answered_ms === undefined || ended_ms === undefined) return false

	return closed_answered_ms >= ended_ms
}

// An ended run asks as a going run does until one ask after it ended has answered whole. After that it
// asks only about a child drawn stopped, until the limit, or waiting on a person — the person closing
// it is what the board waits to draw. `undefined` while the run still asks as a going run does.
function ended_asked_states(
	state: BoardState,
	local: LocalRead,
	now_ms: number,
): ReadonlySet<ItemState> | undefined {
	const { ended_ms } = local
	if (ended_ms === undefined || !has_asked_since_end(state, ended_ms)) return undefined

	return now_ms - ended_ms <= STOPPED_ASK_LIMIT_MS ? ALWAYS_ASKED_STATES : WAITING_STATES
}

const run_board_closed_pace = { ALWAYS_ASKED_STATES, STOPPED_ASK_LIMIT_MS, ended_asked_states }

export { run_board_closed_pace }
