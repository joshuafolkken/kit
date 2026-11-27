import { describe, expect, it } from 'vitest'
import { run_board_theme_rk800 } from './run-board-theme-rk800'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_fixture } from './run-board-theme-rk800-fixture'
import { run_board_theme_rk800_led } from './run-board-theme-rk800-led'

// joshuafolkken/kit#9096: the rk800 theme — the screens of Detroit: Become Human on the board.

const { RGB } = run_board_theme_rk800_data
const { SPINNER } = run_board_theme_rk800_led
const { HOST, fresh_grid, row_text, state_at } = run_board_theme_rk800_fixture
const THEME = run_board_theme_rk800.theme(HOST.api)
const LEVEL_ROW = HOST.layout.level_spot.y
// The demo's events start typing on tick 10; a NOTICE's wall starts twenty ticks in.
const START = 10
const IDLE_TICK = 100
const WALL_TICK = START + 40

describe('run_board_theme_rk800.theme', () => {
	it('names its board and its spinner, and plays an opening and an ending', () => {
		expect([THEME.name, THEME.board, THEME.spinner]).toStrictEqual([
			'DETROIT',
			'josh-rk800',
			SPINNER,
		])
		expect(THEME.opening?.ticks).toBe(134)
		expect(THEME.ending).toBeDefined()
	})

	it('plays through an event and rests while idle', () => {
		expect(THEME.playing?.(state_at('i', IDLE_TICK))).toBe(false)
		expect(THEME.playing?.(state_at('n', WALL_TICK))).toBe(true)
		expect(THEME.playing?.(state_at('p', START + 20))).toBe(true)
	})

	it('washes the idle board in the night and a NOTICE’s build in red', () => {
		const idle = state_at('i', IDLE_TICK)
		const notice = state_at('n', WALL_TICK)

		expect(THEME.background?.(0, 0, IDLE_TICK, idle)).toBe(RGB.night)
		expect(THEME.background?.(0, 0, WALL_TICK, notice)).not.toBe(RGB.night)
	})

	it('reads a calm stress on the level while idle', () => {
		const grid = fresh_grid()

		THEME.draw(grid, state_at('i', IDLE_TICK), IDLE_TICK)
		expect(row_text(grid, LEVEL_ROW)).toContain('STRESS 10%')
	})

	it('climbs the stress through a NOTICE and puts the order in the header', () => {
		const grid = fresh_grid()

		THEME.draw(grid, state_at('n', WALL_TICK), WALL_TICK)
		expect(row_text(grid, LEVEL_ROW)).toContain('STRESS 50%')
		expect(row_text(grid, 0).slice(0, HOST.layout.head_left.w)).toContain('MOVE')
	})
})
