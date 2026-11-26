import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_parts } from './run-board-theme-host-parts'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid } from './run-board-theme-host-types'

// joshuafolkken/kit#8917: the picture tube and the plain opening and ending, on the confirmed demo's
// screen (60 rows by 199 columns). The plain pair is also checked frame by frame against the demo
// host in the frame test.

const { HOST } = run_board_theme_host_fixture
const { layout } = HOST
const {
	TUBE_GLOW,
	blank_screen,
	eased,
	plain_ending,
	plain_opening,
	tube_off,
	tube_on,
	tube_picture,
} = run_board_theme_host_parts
const { state_of } = run_board_theme_host_state
const IDLE_STATE = state_of(layout, HOST.events.i, 0)
const BLACK = '\u{1B}[48;2;0;0;0m'

function board_copy(): Grid {
	return HOST.board.map((row) => [...row])
}

function text_of(grid: Grid): Array<string> {
	return grid.map((row) => row.map(([ch]) => ch).join(''))
}

describe('run_board_theme_host_parts.eased', () => {
	it('eases in and out between 0 and 1, clamped', () => {
		expect([-1, 0, 0.5, 1, 2].map((share) => eased(share))).toStrictEqual([0, 0, 0.5, 1, 1])
		expect(eased(0.25)).toBeCloseTo(0.15625)
	})
})

describe('run_board_theme_host_parts.tube_picture', () => {
	it('shows only the glowing dot at the centre for a picture of no size', () => {
		const grid = board_copy()

		tube_picture(grid, layout, { w: 0, h: 0 })
		const cells = grid.flatMap((row, y) => row.map(([, style], x) => ({ y, x, style })))
		const lit = cells.filter(({ style }) => style !== BLACK)
		const centre = { y: layout.h / 2, x: Math.floor(layout.w / 2) }

		expect(lit).toStrictEqual([{ ...centre, style: TUBE_GLOW }])
		expect(grid.every((row) => row.length === layout.w)).toBe(true)
	})

	it('leaves the board as it is for a full picture', () => {
		const grid = board_copy()

		tube_picture(grid, layout, { w: layout.w, h: layout.h / 2 })

		expect(grid).toStrictEqual(HOST.board)
	})
})

describe('run_board_theme_host_parts tube on and off', () => {
	it('lasts the demo’s ticks', () => {
		expect(tube_on(layout).ticks).toBe(42)
		expect(tube_off(layout).ticks).toBe(66)
	})

	it('ends the switch-off on a black screen', () => {
		const grid = board_copy()

		tube_off(layout).draw(grid, 65, IDLE_STATE)

		expect(grid.every((row) => row.every(([ch, style]) => ch === ' ' && style === BLACK))).toBe(
			true,
		)
	})

	it('settles to the board once the switch-on has bloomed', () => {
		const grid = board_copy()

		tube_on(layout).draw(grid, 41, IDLE_STATE)

		expect(grid).toStrictEqual(HOST.board)
	})
})

describe('run_board_theme_host_parts plain opening and ending', () => {
	it('types the name on an empty screen, its cursor after it', () => {
		const opening = plain_opening('TEST', layout)
		const grid = board_copy()

		opening.draw(grid, 2, IDLE_STATE)
		const rows = text_of(grid)

		expect(opening.ticks).toBe('> TEST'.length + 20 + 30 + 10)
		expect(rows[20]?.trimEnd()).toBe('    > T█')
		expect(rows.filter((row) => row.trim() !== '')).toHaveLength(1)
	})

	it('takes the board away two rows a tick from the bottom', () => {
		const ending = plain_ending('TEST', layout)
		const grid = board_copy()

		ending.draw(grid, 5, IDLE_STATE)

		expect(ending.ticks).toBe(50)
		expect(text_of(grid).slice(0, 50)).toStrictEqual(text_of(HOST.board).slice(0, 50))
		expect(
			text_of(grid)
				.slice(50)
				.every((row) => row.trim() === ''),
		).toBe(true)
	})

	it('blanks the whole screen', () => {
		const grid = board_copy()

		blank_screen(grid, layout)

		expect(grid.every((row) => row.length === layout.w && row.every(([ch]) => ch === ' '))).toBe(
			true,
		)
	})
})
