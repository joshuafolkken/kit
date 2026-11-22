import { describe, expect, it } from 'vitest'
import { run_board_jump } from './run-board-jump'
import { run_board_jump_paint, type PaintCell } from './run-board-jump-paint'
import { run_board_lane_swap, type LaneSwap } from './run-board-lane-swap'
import type { Rgb } from './run-board-rgb'
import type { KeyedLine } from './run-board-type-rows'

const { CLEAR_AT, NEXT_AT, NEXT_TICKS } = run_board_jump
const { ICE } = run_board_jump_paint
const { left_lane, remembered, swapped } = run_board_lane_swap

const WHITE: Rgb = [255, 255, 255]
const OWN: Rgb = [10, 20, 30]
const GONE: Rgb = [200, 100, 50]
const LANE_ROW = 2
const WIDTH = 6
const THAW_SPAN = NEXT_TICKS / 2
const MERGED = 'lanes:8711'
const NEXT = 'lanes:2'

function line(key: string, row: number, text = key): KeyedLine {
	return { key, row, index: row - 1, text, prefix_columns: 0 }
}

function cell(x: number, y: number, text = 'n'): PaintCell {
	return { x, y, text, fg: OWN, is_figure: false }
}

// A board of three rows `WIDTH` wide, its lane row reading `next...`.
function board(): Array<PaintCell> {
	return Array.from({ length: 3 * WIDTH }, (_, index) =>
		cell(index % WIDTH, Math.floor(index / WIDTH), 'next..'[index % WIDTH]),
	)
}

// The merged row, two letters shorter than the board.
const SWAP: LaneSwap = {
	row: LANE_ROW,
	cells: Array.from('gone', (text, x) => ({ ...cell(x, 0, text), fg: GONE })),
}

function lane_at(t: number): Array<PaintCell> {
	return swapped(board(), t, SWAP).filter((painted) => painted.y === LANE_ROW)
}

function others_at(t: number): Array<PaintCell> {
	return swapped(board(), t, SWAP).filter((painted) => painted.y !== LANE_ROW)
}

describe('run_board_lane_swap.remembered', () => {
	it('ac-066a13f7 keeps the row the noticed lane dropped while its merge notice shows', () => {
		const merged = line(MERGED, 4)
		const next = line(NEXT, 4)
		const first = remembered(undefined, [merged, line(NEXT, 5)], 8711)
		const dropped = remembered(first, [next], 8711)

		expect(first.left).toStrictEqual([])
		expect(dropped.left).toStrictEqual([merged])
		expect(remembered(dropped, [next], 8711).left).toStrictEqual([merged])
		expect(remembered(dropped, [], 8711).left).toStrictEqual([merged])
	})

	it('remembers no row a fold, a resize or a fit cut drops of another lane or with no notice', () => {
		const shown = [line(MERGED, 4), line(NEXT, 5)]
		const first = remembered(undefined, shown, undefined)

		expect(remembered(first, [], undefined).left).toStrictEqual([])
		expect(remembered(first, [line(MERGED, 4)], 8711).left).toStrictEqual([])
		expect(remembered(remembered(first, [], undefined), [], 8711).left).toStrictEqual([])
	})
})

describe('run_board_lane_swap.left_lane', () => {
	it('ac-066a13f7 names the row the merged lane left, 0-based, with its text', () => {
		const memory = { lines: [], left: [{ ...line(MERGED, 5, 'shown'), source: 'raw' }] }

		expect(left_lane(memory, 8711)).toStrictEqual({ row: 4, text: 'raw' })
		expect(left_lane({ ...memory, left: [line(MERGED, 5, 'shown')] }, 8711)).toStrictEqual({
			row: 4,
			text: 'shown',
		})
	})

	it('names none for another issue, no issue or no memory', () => {
		const memory = { lines: [], left: [line('lanes:87110', 5)] }

		expect(left_lane(memory, 8711)).toBeUndefined()
		expect(left_lane(memory, undefined)).toBeUndefined()
		expect(left_lane(undefined, 8711)).toBeUndefined()
	})
})

describe('run_board_lane_swap.swapped', () => {
	it('ac-066a13f7 draws the merged row back until the clear, blank past its end', () => {
		for (const t of [-3, 0, CLEAR_AT - 1]) {
			expect(lane_at(t).map((painted) => painted.text)).toStrictEqual([...'gone  '])
			expect(lane_at(t)[0]?.fg).toStrictEqual(GONE)
			expect(lane_at(t)[0]?.y).toBe(LANE_ROW)
		}
	})

	it('ac-066a13f7 leaves the row blank from the clear until the next row arrives', () => {
		for (const t of [CLEAR_AT, NEXT_AT - 1]) {
			expect(lane_at(t).every((painted) => painted.text === ' ')).toBe(true)
			expect(lane_at(t).every((painted) => painted.bg === undefined)).toBe(true)
		}
	})

	it('ac-066a13f7 brings the next row in white for two ticks', () => {
		for (const t of [NEXT_AT, NEXT_AT + 1]) {
			expect(lane_at(t).map((painted) => painted.text)).toStrictEqual([...'next..'])
			expect(lane_at(t).every((painted) => painted.fg.join(',') === WHITE.join(','))).toBe(true)
		}
	})

	it('ac-066a13f7 thaws the next row from ice to its own colors, each cell late by its noise', () => {
		const early = lane_at(NEXT_AT + 2)
		const done = lane_at(NEXT_AT + 2 * THAW_SPAN - 1)

		expect(early.every((painted) => painted.fg.join(',') !== WHITE.join(','))).toBe(true)
		expect(early.some((painted) => painted.fg.join(',') !== early[0]?.fg.join(','))).toBe(true)
		expect(early.every((painted) => painted.fg[0] >= OWN[0] && painted.fg[0] <= ICE[0])).toBe(true)
		expect(done.every((painted) => Math.abs(painted.fg[0] - OWN[0]) <= 10)).toBe(true)
	})
})

describe('run_board_lane_swap.swapped — outside the swap', () => {
	it('leaves the board as it is once the next row has thawed, and the other rows throughout', () => {
		expect(swapped(board(), NEXT_AT + NEXT_TICKS, SWAP)).toStrictEqual(board())
		expect(others_at(CLEAR_AT)).toStrictEqual(board().filter((painted) => painted.y !== LANE_ROW))
	})

	it('ac-0cd6f361 leaves the board as it is with no swap', () => {
		expect(swapped(board(), CLEAR_AT, undefined)).toStrictEqual(board())
	})
})
