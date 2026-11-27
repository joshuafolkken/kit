import { describe, expect, it } from 'vitest'
import { run_board_theme_draw } from './run-board-theme-draw'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import type { Grid } from './run-board-theme-host-types'
import { run_board_theme_isac_data } from './run-board-theme-isac-data'
import { run_board_theme_isac_opening } from './run-board-theme-isac-opening'
import { run_board_theme_magi_fixture } from './run-board-theme-magi-fixture'

// joshuafolkken/kit#9096: the isac theme's opening.

const { opening_of } = run_board_theme_isac_opening
const { HOST } = run_board_theme_host_fixture
const { fresh_grid, row_text, state_at } = run_board_theme_magi_fixture
const { PAIR, is_drawn } = run_board_theme_draw
const { INKS, OPEN } = run_board_theme_isac_data
const FADING = OPEN.fade_from + OPEN.fade_ticks / PAIR

function opened_at(tick: number): Grid {
	const grid = fresh_grid()

	opening_of(HOST.api).draw(grid, tick, state_at('i', tick))

	return grid
}

function screen_text(grid: Grid): string {
	return grid.map((row) => row.map(([ch]) => ch).join('')).join('\n')
}

describe('run_board_theme_isac_opening.opening_of', () => {
	it('plays as long as the table says', () => {
		expect(opening_of(HOST.api).ticks).toBe(OPEN.ticks)
	})

	it('types the title under the ring’s middle on an empty screen from the first tick', () => {
		const { screen_cx, screen_cy } = HOST.layout
		const first = opened_at(0)
		const typed = opened_at(OPEN.title.length - 1)
		const title_x = screen_cx - Math.floor(OPEN.title.length / PAIR)

		expect(first[screen_cy]?.[title_x]).toStrictEqual(['T', INKS.WHITE])
		expect(row_text(first, screen_cy)).not.toContain('TE')
		expect(row_text(typed, screen_cy)).toContain(OPEN.title)
		expect(first[screen_cy - OPEN.radius.y]?.[screen_cx]).toStrictEqual(['∙', INKS.BRIGHT])
	})
})

describe('run_board_theme_isac_opening.opening_of — the board', () => {
	it('shows none of the board before the brackets run out', () => {
		const text = screen_text(opened_at(0))

		expect(text).not.toContain(row_text(HOST.board, HOST.layout.level_spot.y).trim())
	})

	it('runs brackets out from the ring, the board showing dim inside them', () => {
		const grid = opened_at(OPEN.expand_from + OPEN.expand_ticks / PAIR)
		const text = screen_text(grid)

		expect(text).toContain('┌──')
		expect(text).toContain('──┘')
		expect(grid.flat().filter((cell) => is_drawn(cell)).length).toBeGreaterThan(0)
	})

	it('fades the board in as one orange, then leaves the board as it is', () => {
		const fading = opened_at(FADING)
		const styles = new Set(
			fading
				.flat()
				.filter((cell) => is_drawn(cell))
				.map(([, style]) => style),
		)

		expect(styles.size).toBe(1)
		expect(screen_text(fading)).toBe(screen_text(HOST.board))
		expect(opened_at(OPEN.fade_from + OPEN.fade_ticks)).toStrictEqual(fresh_grid())
	})
})
