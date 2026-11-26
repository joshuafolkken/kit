import { describe, expect, it } from 'vitest'
import { run_board_cells, type Cells } from './run-board-cells'
import { run_board_cells_ansi } from './run-board-cells-ansi'
import { run_board_cells_diff } from './run-board-cells-diff'
import { run_board_seeded, type Random } from './run-board-seeded-fixture'

// joshuafolkken/kit#8826: only the cells that changed are written, and the front made the back.
// joshuafolkken/kit#8917: runs carry through a few unchanged cells, and a background alone changes alone.

const { cells_of, copy } = run_board_cells
const { paint } = run_board_cells_ansi
const { diff } = run_board_cells_diff
const { seeded } = run_board_seeded
const ESC = '\u{1B}'
const RED = `${ESC}[31m`
const GREEN = `${ESC}[32m`
const NAVY = `${ESC}[48;2;1;2;3m`
const TEAL = `${ESC}[48;2;4;5;6m`
const NO_BACKGROUND = `${ESC}[49m`
const RESET = `${ESC}[0m`
const SIZE = { rows: 2, columns: 8 }
const SEED = 8917
const FRAMES = 200
const TOKENS_PER_FRAME = 24
// Text two columns at a time, so a wide character never lands half over another: `paint` leaves the far
// half of a wide character overwritten at its first half where a terminal would blank it.
const TOKENS: ReadonlyArray<string> = [
	'ab',
	'c ',
	' a',
	'  ',
	'日',
	'\n',
	RED,
	GREEN,
	NAVY,
	TEAL,
	NO_BACKGROUND,
	RESET,
	`${ESC}]8;;https://example.com${ESC}\\`,
	`${ESC}]8;;${ESC}\\`,
]

function painted(text: string): Cells {
	const cells = cells_of(SIZE)

	paint(cells, text)

	return cells
}

function random_text(random: Random): string {
	return Array.from(
		{ length: TOKENS_PER_FRAME },
		() => TOKENS[Math.floor(random() * TOKENS.length)] ?? '',
	).join('')
}

// The screen `front` shows once the diff from it to `back` is painted over it.
function shown_after(back: Cells, front: Cells): Cells {
	const screen = cells_of(SIZE)

	copy(front, screen)
	paint(screen, diff(back, front))

	return screen
}

describe('run_board_cells_diff.diff', () => {
	it('writes nothing where nothing changed', () => {
		expect(diff(painted('abc'), painted('abc'))).toBe('')
	})

	it('writes only the changed cells after one cursor move', () => {
		const front = painted('abc\ndef')

		expect(diff(painted('abc\ndXY'), front)).toBe(`${ESC}[2;2H${RESET}XY`)
	})

	it('writes a cell whose style alone changed, then resets', () => {
		const bytes = diff(painted(`${RED}a`), painted('a'))

		expect(bytes).toBe(`${ESC}[1;1H${RESET}${RED}a${RESET}`)
	})

	it('writes a wide character whole from its first cell', () => {
		expect(diff(painted('日'), painted('ab'))).toBe(`${ESC}[1;1H${RESET}日`)
	})

	it('makes the front the back, so the same back again writes nothing', () => {
		const front = painted('abc')
		const back = painted('xyz')

		diff(back, front)

		expect(front).toStrictEqual(back)
		expect(diff(back, front)).toBe('')
	})
})

describe('run_board_cells_diff.diff — runs', () => {
	it('writes through one unchanged cell instead of moving the cursor', () => {
		expect(diff(painted('XbY'), painted('abc'))).toBe(`${ESC}[1;1H${RESET}XbY`)
	})

	it('writes through three unchanged cells instead of moving the cursor', () => {
		expect(diff(painted('X123Y'), painted('01234'))).toBe(`${ESC}[1;1H${RESET}X123Y`)
	})

	it('moves the cursor again past four unchanged cells', () => {
		const bytes = diff(painted('X1234Y'), painted('012345'))

		expect(bytes).toBe(`${ESC}[1;1H${RESET}X${ESC}[1;6HY`)
	})

	it('moves the cursor over unchanged cells whose rewrite, with its styles, is longer', () => {
		const back = painted(`${RED}X${RESET}  ${RED}Y`)
		const bytes = diff(back, painted('a  c'))

		expect(bytes).toBe(`${ESC}[1;1H${RESET}${RED}X${ESC}[1;4HY${RESET}`)
	})

	it('ends a run at the row end and moves the cursor to the next row', () => {
		const bytes = diff(painted('abcdefgX\nXbc'), painted('abcdefgh\nabc'))

		expect(bytes).toBe(`${ESC}[1;8H${RESET}X${ESC}[2;1HX`)
	})

	it('writes an unchanged wide character inside a run whole', () => {
		expect(diff(painted('X日Y'), painted('a日c'))).toBe(`${ESC}[1;1H${RESET}X日Y`)
	})
})

describe('run_board_cells_diff.diff — background-only changes', () => {
	it('writes only the new 24-bit background where the background alone changed', () => {
		const bytes = diff(painted(`${RED}${NAVY}a${TEAL}b`), painted('ab'))

		expect(bytes).toBe(`${ESC}[1;1H${RESET}${RED}${NAVY}a${TEAL}b${RESET}`)
	})

	it('writes only the default background where the background alone was dropped', () => {
		const bytes = diff(painted(`${RED}${NAVY}a${NO_BACKGROUND}b`), painted('ab'))

		expect(bytes).toBe(`${ESC}[1;1H${RESET}${RED}${NAVY}a${NO_BACKGROUND}b${RESET}`)
	})

	it('writes a reset and the whole style where the foreground changed', () => {
		const bytes = diff(painted(`${RED}${NAVY}a${GREEN}b`), painted('ab'))

		expect(bytes).toBe(`${ESC}[1;1H${RESET}${RED}${NAVY}a${RESET}${GREEN}${NAVY}b${RESET}`)
	})

	it('paints, over the last screen, the new cells for seeded random frames', () => {
		const random = seeded(SEED)
		const front = painted(random_text(random))

		for (let frame = 0; frame < FRAMES; frame += 1) {
			const back = painted(random_text(random))

			expect(shown_after(back, cells_of(SIZE))).toStrictEqual(back)
			expect(shown_after(back, front)).toStrictEqual(back)
		}
	})
})
