import { describe, expect, it } from 'vitest'
import { run_board_drop_screen, type FrameSpots } from './run-board-drop-screen'
import type { Typing } from './run-board-type-rows'

// joshuafolkken/kit#8367: the last frame drawn, cell by cell on screen, for the drop to light and put back.

const { cell_at, filled, is_kept, screen_of } = run_board_drop_screen
const GREEN = '\u{1B}[32m'
const RESET = '\u{1B}[0m'
const IDLE: Typing = { seen: undefined, lines: [] }

function frame(lines: ReadonlyArray<string>, extra: Partial<FrameSpots> = {}): FrameSpots {
	return { lines, spots: [], ...extra }
}

describe('run_board_drop_screen.screen_of', () => {
	it('keeps each cell’s character with the colors it was drawn in', () => {
		const screen = screen_of(frame([`a${GREEN}b${RESET}`]), IDLE, { rows: 5, columns: 10 })

		expect(cell_at(screen, { row: 1, column: 1 })).toEqual({ text: 'a', style: '', is_wide: false })
		expect(cell_at(screen, { row: 1, column: 2 })).toEqual({
			text: 'b',
			style: GREEN,
			is_wide: false,
		})
	})

	it('wraps a line at the terminal’s columns and cuts the frame to its rows', () => {
		const screen = screen_of(frame(['abcdef', '', 'gh', 'ij']), IDLE, { rows: 4, columns: 4 })

		expect(screen.rows.map((row) => row.map((cell) => cell.text).join(''))).toEqual([
			'abcd',
			'ef',
			'',
			'gh',
		])
		expect(screen.columns).toBe(4)
	})

	it('spans the widest line with no terminal size', () => {
		const screen = screen_of(frame(['ab', 'abcde']), IDLE, undefined)

		expect(screen.rows).toHaveLength(2)
		expect(screen.columns).toBe(5)
	})

	it('reads a blank past a line’s end', () => {
		const screen = screen_of(frame(['a']), IDLE, { rows: 3, columns: 8 })

		expect(cell_at(screen, { row: 1, column: 6 }).text).toBe(' ')
		expect(cell_at(screen, { row: 3, column: 1 }).text).toBe(' ')
	})
})

describe('run_board_drop_screen.screen_of — a wide character at a row’s end', () => {
	it('starts a wide character landing on a row’s last column on the next row', () => {
		const screen = screen_of(frame(['abc日d']), IDLE, { rows: 3, columns: 4 })

		expect(cell_at(screen, { row: 1, column: 4 }).text).toBe(' ')
		expect(cell_at(screen, { row: 2, column: 1 }).text).toBe('日')
		expect(cell_at(screen, { row: 2, column: 3 }).text).toBe('d')
	})
})

// joshuafolkken/kit#8739: the one fill the bttf jump and its fire trails share.
describe('run_board_drop_screen.filled', () => {
	const letter = { text: 'a', style: 'S', is_wide: false }
	const blank = { text: ' ', style: '', is_wide: false }
	const screen = {
		rows: [[letter], []],
		columns: 3,
		skips: new Set<string>(),
		typing_rows: new Set<number>(),
	}

	it('fills every row out to the screen width with blank cells and adds blank rows to the height', () => {
		expect(filled(screen, 3).rows).toStrictEqual([
			[letter, blank, blank],
			[blank, blank, blank],
			[blank, blank, blank],
		])
	})

	it('keeps every row of a screen taller than the height', () => {
		expect(filled(screen, 0).rows).toHaveLength(2)
	})
})

describe('run_board_drop_screen.is_kept', () => {
	it('keeps both halves of a character two columns wide', () => {
		const screen = screen_of(frame(['a日b']), IDLE, { rows: 2, columns: 8 })

		expect([1, 2, 3, 4].map((column) => is_kept(screen, { row: 1, column }))).toEqual([
			false,
			true,
			true,
			false,
		])
	})

	it('keeps the cells the spin writes and the rows still typing', () => {
		const lines = ['abc', 'def', 'ghi']
		const spots = [{ row: 1, column: 2, style: '' }]
		const traces = [{ row: 3, column: 3, style: '' }]
		const typing: Typing = {
			seen: undefined,
			lines: [{ key: 'k', index: 1, row: 2, text: 'def', prefix_columns: 0, start_ms: 0 }],
		}
		const screen = screen_of(frame(lines, { spots, traces }), typing, { rows: 3, columns: 3 })

		expect(is_kept(screen, { row: 1, column: 2 })).toBe(true)
		expect(is_kept(screen, { row: 2, column: 1 })).toBe(true)
		expect(is_kept(screen, { row: 3, column: 3 })).toBe(true)
		expect(is_kept(screen, { row: 1, column: 1 })).toBe(false)
	})
})
