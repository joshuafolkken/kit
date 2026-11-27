import { describe, expect, it } from 'vitest'
import { run_board_theme_deviant_after } from './run-board-theme-deviant-after'
import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_notice } from './run-board-theme-deviant-notice'
import { run_board_theme_deviant_parts } from './run-board-theme-deviant-parts'
import type { ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid, ThemeApi } from './run-board-theme-host-types'

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
// Past the shards and the returning ring, the objective fully typed: only its own cells change.
const SETTLED = 60
// The panel starts at this column on a narrow screen, so the data pane is one cell narrower.
const NARROW_PX = 10
const OBJECTIVE_ROWS = [0, 1, 2].map((row) => OBJECTIVE_ROW + row)
const LEFT = Math.max(0, OBJECTIVE.chip_x - 1)
const RIGHT = OBJECTIVE.text_x + Math.max(OBJECTIVE.bold.length, OBJECTIVE.rule_w) + 1

function after_at(since: number, api: ThemeApi = HOST.api): Grid {
	const grid = HOST.board.map((row) => row.map((cell): Cell => [cell[0], cell[1]]))
	const state = state_of(HOST.layout, HOST.events.n, 0)
	const draw: ThemeDraw = { api, grid, s: state, tick: 0 }

	after(draw, since)

	return grid
}

function text_of(grid: Grid, y: number): string {
	return (grid[y] ?? []).map(([ch]) => ch).join('')
}

function is_inside(x: number, y: number): boolean {
	return OBJECTIVE_ROWS.includes(y) && x >= LEFT && x < RIGHT
}

// The [x, y] of every cell of `grid` that differs from the board.
function changed_cells(grid: Grid): Array<[number, number]> {
	return grid.flatMap((row, row_y) =>
		row
			.map((cell, col_x): [number, number, Cell] => [col_x, row_y, cell])
			.filter(
				([col_x, , cell]) => JSON.stringify(cell) !== JSON.stringify(HOST.board[row_y]?.[col_x]),
			)
			.map(([col_x]): [number, number] => [col_x, row_y]),
	)
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

describe('run_board_theme_deviant_after.after objective box', () => {
	it('changes no cell outside the objective box, and only to text or blank inside it', () => {
		const grid = after_at(SETTLED)

		expect(changed_cells(grid).filter(([x, y]) => !is_inside(x, y))).toStrictEqual([])
		expect(OBJECTIVE_ROWS.map((y) => text_of(grid, y).slice(LEFT, RIGHT))).toSatisfy(
			(rows: Array<string>) => rows.every((row) => /^[ ▌A-Z─]*$/u.test(row)),
		)
	})

	it('cuts the objective at a narrow data pane as put_in does, leaving the rest', () => {
		const api = { ...HOST.api, layout: { ...HOST.layout, px: NARROW_PX } }
		const grid = after_at(SETTLED, api)

		expect(text_of(grid, OBJECTIVE_ROW).slice(0, NARROW_PX - 1)).toBe(' ▌ N O T ')
		expect(changed_cells(grid).filter(([x]) => x >= NARROW_PX - 1)).toStrictEqual([])
	})
})
