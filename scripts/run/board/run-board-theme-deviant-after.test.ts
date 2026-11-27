import { describe, expect, it } from 'vitest'
import { run_board_theme_deviant_after } from './run-board-theme-deviant-after'
import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_notice } from './run-board-theme-deviant-notice'
import { run_board_theme_deviant_parts } from './run-board-theme-deviant-parts'
import type { ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid } from './run-board-theme-host-types'

// joshuafolkken/kit#9096: the deviant theme's NOTICE after its peak — the spark, color returning
// from the wall's middle, and the objective stamped across the data.

const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state
const { after } = run_board_theme_deviant_after
const { RGB } = run_board_theme_deviant_data
const { OBJECTIVE, RETURN, SHARDS } = run_board_theme_deviant_notice
const { ink } = run_board_theme_deviant_parts
const OBJECTIVE_ROW = HOST.layout.area_top + 1 + OBJECTIVE.row
// A few ticks into the objective: its thin line part typed.
const TYPING = 5

function after_at(since: number): Grid {
	const grid = HOST.board.map((row) => row.map((cell): Cell => [cell[0], cell[1]]))
	const state = state_of(HOST.layout, HOST.events.n, 0)
	const draw: ThemeDraw = { api: HOST.api, grid, s: state, tick: 0 }

	after(draw, since)

	return grid
}

function text_of(grid: Grid, y: number): string {
	return (grid[y] ?? []).map(([ch]) => ch).join('')
}

describe('run_board_theme_deviant_after.after', () => {
	it('sparks the whole screen at the peak', () => {
		const styles = new Set(
			after_at(0)
				.flat()
				.map(([, style]) => style),
		)

		expect(styles.size).toBe(1)
	})

	it('keeps the board grey outside the returning ring, but the notice row', () => {
		const grid = after_at(SHARDS.spark)
		const corner = grid.at(-1)?.at(-1)

		expect(corner?.[1]).toBe(ink(RGB.grey))
		expect(grid[HOST.layout.notice.y]?.[0]).toStrictEqual(HOST.board[HOST.layout.notice.y]?.[0])
	})

	it('stamps the objective beside a blue chip across the data', () => {
		const text = text_of(after_at(OBJECTIVE.from + TYPING), OBJECTIVE_ROW)
		const shown = TYPING * OBJECTIVE.pace

		expect(text.slice(OBJECTIVE.chip_x, OBJECTIVE.text_x + shown)).toBe(
			`▌ ${OBJECTIVE.thin.slice(0, shown)}`,
		)
	})

	it('leaves the board as it is once every part has ended', () => {
		const since = Math.max(OBJECTIVE.until, SHARDS.ticks, RETURN.ticks)

		expect(after_at(since)).toStrictEqual(HOST.board)
	})
})
