import { describe, expect, it } from 'vitest'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid } from './run-board-theme-host-types'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_ending } from './run-board-theme-rk800-ending'
import { run_board_theme_rk800_parts } from './run-board-theme-rk800-parts'
import { run_board_theme_rk800_tables } from './run-board-theme-rk800-tables'

// joshuafolkken/kit#9096: the rk800 theme's ending — the board frozen grey, the results on the
// ice, the bars gone dark and a second of empty screen.

const { HOST } = run_board_theme_host_fixture
const { TICK_MS, state_of } = run_board_theme_host_state
const { ending_of } = run_board_theme_rk800_ending
const { RGB } = run_board_theme_rk800_data
const { ink, mix } = run_board_theme_rk800_parts
const { RESULTS } = run_board_theme_rk800_tables
const ENDING = ending_of(HOST.api)
const STATUS_LETTERS = `${RESULTS.word} ${RESULTS.rest}`.length

function board_copy(): Grid {
	return HOST.board.map((row) => row.map((cell): Cell => [cell[0], cell[1]]))
}

function ending_at(tick: number): Grid {
	const grid = board_copy()

	ENDING.draw(grid, tick, state_of(HOST.layout, HOST.events.x, tick))

	return grid
}

function screen_text(grid: Grid): string {
	return grid.map((row) => row.map(([ch]) => ch).join('')).join('\n')
}

describe('run_board_theme_rk800_ending.ending_of', () => {
	it('lasts until the bars have shut and the empty screen has held', () => {
		expect(ENDING.ticks).toBe(RESULTS.shut_from + RESULTS.shut_ticks + RESULTS.empty_ticks)
	})

	it('types the status line two letters a tick from its start', () => {
		const from_ms = RESULTS.status_from * TICK_MS
		const to_ms = (RESULTS.status_from + Math.ceil(STATUS_LETTERS / RESULTS.pace)) * TICK_MS

		expect(ENDING.typing).toStrictEqual({ spans: [{ from_ms, to_ms }], typed_ms: to_ms })
	})

	it('freezes the board grey, keeping its letters, before the bars close', () => {
		const grid = ending_at(0)
		const grey = ink(mix(RGB.grey, RGB.night, RESULTS.grey))

		expect(screen_text(grid)).toBe(screen_text(HOST.board))
		expect(grid.flat().every(([, style]) => style === grey)).toBe(true)
	})

	it('stands MISSION SUCCESSFUL once the bars have closed', () => {
		const tick = RESULTS.status_from + Math.ceil(STATUS_LETTERS / RESULTS.pace)

		expect(screen_text(ending_at(tick))).toContain(`${RESULTS.word} ${RESULTS.rest}`)
	})

	it('leaves the screen empty at its end', () => {
		const empty = board_copy()

		HOST.api.blank_screen(empty)
		expect(ending_at(ENDING.ticks - 1)).toStrictEqual(empty)
	})
})
