import { run_board_frame_diff } from './run-board-frame-diff'
import { run_board_jump, type LeftLane } from './run-board-jump'
import { run_board_jump_paint, type PaintCell } from './run-board-jump-paint'
import { run_board_rgb } from './run-board-rgb'
import type { KeyedLine } from './run-board-type-rows'

// joshuafolkken/kit#8711: the bttf jump's lane swap. A merged lane's row leaves the board on the frame
// its merge notice starts typing, so the board remembers the lane rows each frame drops; the jump draws
// the merged one back at its row until `CLEAR_AT`, leaves the row blank until `NEXT_AT`, then the row
// the board now draws there arrives cold: white for `WHITE_TICKS`, then ice thawing to its own colors,
// each cell late by its noise.

const { CLEAR_AT, NEXT_AT, NEXT_TICKS } = run_board_jump
const { ICE, noise } = run_board_jump_paint
const { mixed, parsed } = run_board_rgb

const WHITE = parsed('255;255;255')
const WHITE_TICKS = 2
// A cell thaws over half the arrival, late by up to the other half.
const HALF = 2
const THAW_SPAN = NEXT_TICKS / HALF

// The keyed lines the last frame drew and the lane rows the latest frame that dropped any dropped.
interface LaneMemory {
	lines: ReadonlyArray<KeyedLine>
	left: ReadonlyArray<KeyedLine>
}

// The merged lane's row as the jump draws it back: its row, 0-based, and its cells.
interface LaneSwap {
	row: number
	cells: ReadonlyArray<PaintCell>
}

const NO_MEMORY: LaneMemory = { lines: [], left: [] }

function is_lane_of(line: KeyedLine, issue: number): boolean {
	return line.key.endsWith(`:${String(issue)}`)
}

// The memory after a frame drawing `lines` under a merge notice naming `issue`: the row it dropped of
// that lane, else the one dropped before. Rows a fold, a resize or a fit cut drops are another lane's
// or dropped with no merge notice, so the jump never draws a stale row back.
function remembered(
	last: LaneMemory | undefined,
	lines: ReadonlyArray<KeyedLine>,
	issue: number | undefined,
): LaneMemory {
	if (issue === undefined) return { lines, left: [] }
	const { lines: before, left: earlier } = last ?? NO_MEMORY
	const left = run_board_frame_diff
		.departures(before, lines)
		.filter((line) => is_lane_of(line, issue))

	return { lines, left: left.length > 0 ? left : earlier }
}

// The row the lane of `issue` left, none where no remembered row is its.
function left_lane(
	memory: LaneMemory | undefined,
	issue: number | undefined,
): LeftLane | undefined {
	if (issue === undefined) return undefined
	const line = memory?.left.find((left) => is_lane_of(left, issue))

	return line === undefined ? undefined : { row: line.row - 1, text: line.source ?? line.text }
}

function blank(cell: PaintCell): PaintCell {
	return { ...cell, text: ' ', bg: undefined }
}

// The merged row's cell at the column of `cell`, blank past its end.
function departed(cell: PaintCell, swap: LaneSwap): PaintCell {
	const gone = swap.cells.find((left) => left.x === cell.x)

	return gone === undefined ? blank(cell) : { ...gone, y: cell.y, is_figure: false }
}

// The next row's cell `since` ticks after it arrived: white, then from ice to its own color.
function arrived(cell: PaintCell, since: number): PaintCell {
	if (since < WHITE_TICKS) return { ...cell, fg: WHITE }
	const share = (since - noise(cell.x, cell.y) * THAW_SPAN) / THAW_SPAN

	return { ...cell, fg: mixed(ICE, cell.fg, Math.min(1, Math.max(0, share))) }
}

function swapped_cell(cell: PaintCell, t: number, swap: LaneSwap): PaintCell {
	if (t < CLEAR_AT) return departed(cell, swap)
	if (t < NEXT_AT) return blank(cell)

	return arrived(cell, t - NEXT_AT)
}

// The board `t` ticks from the jump with the lane swap's row over it; as it is with no swap or once the
// next row has thawed.
function swapped(
	cells: ReadonlyArray<PaintCell>,
	t: number,
	swap: LaneSwap | undefined,
): Array<PaintCell> {
	if (swap === undefined || t >= NEXT_AT + NEXT_TICKS) return [...cells]

	return cells.map((cell) => (cell.y === swap.row ? swapped_cell(cell, t, swap) : cell))
}

const run_board_lane_swap = { left_lane, remembered, swapped }

export { run_board_lane_swap }
export type { LaneMemory, LaneSwap }
