import { describe, expect, it } from 'vitest'
import { run_board_theme_draw, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid, ThemeApi } from './run-board-theme-host-types'
import { run_board_theme_rk800_after } from './run-board-theme-rk800-after'
import { run_board_theme_rk800_break } from './run-board-theme-rk800-break'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_notice } from './run-board-theme-rk800-notice'
import { run_board_theme_rk800_parts } from './run-board-theme-rk800-parts'

// joshuafolkken/kit#9096: the rk800 theme's NOTICE after its peak — the spark, color returning
// from the wall's middle, and the objective stamped over the blanked data, the shards behind it.

const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state
const { after } = run_board_theme_rk800_after
const { shards } = run_board_theme_rk800_break
const { data_pane } = run_board_theme_draw
const { RGB } = run_board_theme_rk800_data
const { OBJECTIVE, RETURN, SHARDS } = run_board_theme_rk800_notice
const { ink } = run_board_theme_rk800_parts
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
// The objective typing while the shards still fall, and fully typed after them.
const OBJECTIVE_TICKS = [OBJECTIVE.from + TYPING, SETTLED]
// What the data pane may show behind the objective: blank, or a shard — never the board's own text.
const GROUND_CHARS = new Set([' ', ...SHARDS.glyphs])

// The untouched board as one frame being drawn, every cell its own copy.
function draw_of(api: ThemeApi = HOST.api): ThemeDraw {
	const grid = HOST.board.map((row) => row.map((cell): Cell => [cell[0], cell[1]]))

	return { api, grid, s: state_of(HOST.layout, HOST.events.n, 0), tick: 0 }
}

function after_at(since: number, api: ThemeApi = HOST.api): Grid {
	const draw = draw_of(api)

	after(draw, since)

	return draw.grid
}

function text_of(grid: Grid, y: number): string {
	return (grid[y] ?? []).map(([ch]) => ch).join('')
}

function is_inside(x: number, y: number): boolean {
	return OBJECTIVE_ROWS.includes(y) && x >= LEFT && x < RIGHT
}

// The data left of the panel, on the demo's board.
const PANE = data_pane(draw_of()).box

function is_in_pane(x: number, y: number): boolean {
	return x >= PANE.x && x < PANE.x + PANE.w && y >= PANE.y && y < PANE.y + PANE.h
}

// The characters of the data pane's cells behind the objective: all of it but the objective box.
function ground_chars(grid: Grid): Array<string> {
	return grid.flatMap((row, y) =>
		row.filter((_, x) => is_in_pane(x, y) && !is_inside(x, y)).map(([ch]) => ch),
	)
}

// Every row of `grid` without its data-pane cells.
function outside_pane(grid: Grid): Grid {
	return grid.map((row, y) => row.filter((_, x) => !is_in_pane(x, y)))
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

describe('run_board_theme_rk800_after.after', () => {
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

describe('run_board_theme_rk800_after.after objective layers', () => {
	it.each(OBJECTIVE_TICKS)(
		'hides the board text of the data pane behind the objective at %i',
		(since) => {
			const shown = new Set(ground_chars(after_at(since)))

			expect([...shown].filter((ch) => !GROUND_CHARS.has(ch))).toStrictEqual([])
		},
	)

	it('lets the shards fall over the blanked data pane', () => {
		const fallen = ground_chars(after_at(OBJECTIVE.from + TYPING)).filter((ch) => ch !== ' ')

		expect(fallen.length).toBeGreaterThan(0)
	})

	it.each(OBJECTIVE_TICKS)('keeps the objective box to its text or blank at %i', (since) => {
		const grid = after_at(since)

		expect(OBJECTIVE_ROWS.map((y) => text_of(grid, y).slice(LEFT, RIGHT))).toSatisfy(
			(rows: Array<string>) => rows.every((row) => /^[ ▌A-Z─]*$/u.test(row)),
		)
	})
})

describe('run_board_theme_rk800_after.after outside the data pane', () => {
	it('draws only the shards outside the data pane while they fall', () => {
		const since = OBJECTIVE.from + TYPING
		const expected = draw_of()

		shards(expected, since)

		expect(outside_pane(after_at(since))).toStrictEqual(outside_pane(expected.grid))
	})

	it('leaves the board outside the data pane once the shards are gone', () => {
		expect(outside_pane(after_at(SETTLED))).toStrictEqual(outside_pane(HOST.board))
	})

	it('cuts the objective at a narrow data pane as put_in does, leaving the rest', () => {
		const api = { ...HOST.api, layout: { ...HOST.layout, px: NARROW_PX } }
		const grid = after_at(SETTLED, api)

		expect(text_of(grid, OBJECTIVE_ROW).slice(0, NARROW_PX - 1)).toBe(' ▌ N O T ')
		expect(changed_cells(grid).filter(([x]) => x >= NARROW_PX - 1)).toStrictEqual([])
	})
})
