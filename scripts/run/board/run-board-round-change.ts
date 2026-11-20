import { isDeepStrictEqual } from 'node:util'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_board_data } from './run-board-data'
import type { BoardData, BoardState } from './run-board-state'

// Whether a worker round has a new frame to hand over (joshuafolkken/kit#8330): the frame is assembled
// from the round's data, so a round whose data is the last hand-over's is not assembled again — the
// board's clock and spinner are drawn on its own thread each redraw, and so are the machine's samples,
// which move every round (`run-board-tick-draw.ts` `header_of`). The parts of a frame that move with
// time alone are kept moving: a not-before date flips at its minute, so a new minute hands over again,
// and a pending sound is replayed once its wait passes, so a round with one pending is always handed
// over.

// What a hand-over was assembled from: its data and the minute it was assembled in.
interface RoundInputs {
	data: BoardData
	minute: number
}

function inputs_of(data: BoardData, now_ms: number): RoundInputs {
	return { data, minute: Math.floor(now_ms / MS_PER_MINUTE) }
}

// A run held for memory says the machine's memory gauges on its waiting rows (`run-board-reason.ts`
// `no_memory_of`), so its frame moves with them; otherwise only the header shows them.
function is_same_gauges(last: BoardData, next: BoardData): boolean {
	return next.local?.is_memory_held !== true || isDeepStrictEqual(last.gauges, next.gauges)
}

// The run's read and the idle times are read anew only when a lane read is due, so their reference
// says whether they changed.
function is_same_reads(last: BoardData, next: BoardData): boolean {
	return last.local === next.local && last.idle_since === next.idle_since
}

// The GitHub data is compared by value.
function is_same_data(last: BoardData, next: BoardData): boolean {
	if (!is_same_reads(last, next) || !is_same_gauges(last, next)) return false

	return isDeepStrictEqual(run_board_data.posted(last), run_board_data.posted(next))
}

function is_pending_sound(board: BoardState): boolean {
	return board.sound_pending !== undefined && !board.sound_pending.is_replayed
}

// True when `next` would hand over the frame `last` already did on `board`; with no last hand-over —
// the first round, or one after a round that threw — there is always something to hand over.
function is_unchanged(
	last: RoundInputs | undefined,
	next: RoundInputs,
	board: BoardState,
): boolean {
	if (last === undefined || is_pending_sound(board)) return false

	return last.minute === next.minute && is_same_data(last.data, next.data)
}

const run_board_round_change = { inputs_of, is_unchanged }

export { run_board_round_change }
export type { RoundInputs }
