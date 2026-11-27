import { describe, expect, it } from 'vitest'
import type { ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid, ThemeLayout } from './run-board-theme-host-types'
import { run_board_theme_rk800_break } from './run-board-theme-rk800-break'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_notice } from './run-board-theme-rk800-notice'

// joshuafolkken/kit#9096: the rk800 theme's wall breaking — cracks from its middle, the peak's
// spark and the shards drifting down past the rows they never land on.

const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state
const { center_of, cracks, is_kept_row, is_seat, ray_glyph, shard_at, shards, spark } =
	run_board_theme_rk800_break
const { WALL } = run_board_theme_rk800_data
const { CRACKS, SHARDS } = run_board_theme_rk800_notice
const QUARTER = Math.PI / 4
// A LANES rule above the demo's lane rows 14 to 16, with only row 14 a lane: rows 15 and 16 are free.
const SEATED: ThemeLayout = { ...HOST.layout, lanes_rule: 13, lane_rows: [14] }
const SAMPLE_COLUMNS = 40

function board_copy(): Grid {
	return HOST.board.map((row) => row.map((cell): Cell => [cell[0], cell[1]]))
}

function draw_of(grid: Grid): ThemeDraw {
	return { api: HOST.api, grid, s: state_of(HOST.layout, HOST.events.n, 0), tick: 0 }
}

function changed_rows(grid: Grid): Array<number> {
	return [...grid.keys()].filter((y) =>
		(grid[y] ?? []).some((cell, x) => cell[1] !== HOST.board[y]?.[x]?.[1]),
	)
}

describe('run_board_theme_rk800_break.center_of', () => {
	it('stands the middle in the area, left of the board centre', () => {
		const { x, y } = center_of(HOST.layout)

		expect(y).toBe(HOST.layout.area_top + WALL.center_row)
		expect(x).toBe(Math.floor(HOST.layout.edge * WALL.center))
	})
})

describe('run_board_theme_rk800_break.ray_glyph', () => {
	it('draws a crack by the way it runs', () => {
		expect(
			[0, QUARTER, QUARTER + QUARTER, -QUARTER].map((angle) => ray_glyph(angle)),
		).toStrictEqual(['─', '╲', '│', '╱'])
	})
})

describe('run_board_theme_rk800_break.is_seat', () => {
	it('is a free row under the LANES rule and above the section gap', () => {
		expect([13, 14, 15, 16, 17].map((y) => is_seat(SEATED, y))).toStrictEqual([
			false,
			false,
			true,
			true,
			false,
		])
	})

	it('finds no seat on a board with no LANES rule', () => {
		expect(is_seat({ ...SEATED, lanes_rule: undefined }, 15)).toBe(false)
	})
})

describe('run_board_theme_rk800_break.is_kept_row', () => {
	it('keeps the notice, the progress line and a free seat', () => {
		const { notice, progress } = HOST.layout

		expect([notice.y, progress.y, 15, 14].map((y) => is_kept_row(SEATED, y))).toStrictEqual([
			true,
			true,
			true,
			false,
		])
	})
})

describe('run_board_theme_rk800_break.shard_at', () => {
	it('drifts a shard straight down, never up', () => {
		const sources = Array.from({ length: SAMPLE_COLUMNS }, (_, x) => ({ x, y: 5 }))
		const drifted = sources.map((source) => shard_at(source, SHARDS.spark))
		const landed = drifted.filter((at) => at !== undefined)

		expect(landed.length).toBeGreaterThan(0)
		expect(landed.every((at) => at.y >= 5 && sources.some(({ x }) => x === at.x))).toBe(true)
	})

	it('leaves no shard once the shards have thinned out', () => {
		const sources = Array.from({ length: SAMPLE_COLUMNS }, (_, x) => ({ x, y: 5 }))

		expect(sources.every((source) => shard_at(source, SHARDS.ticks) === undefined)).toBe(true)
	})
})

describe('run_board_theme_rk800_break.cracks', () => {
	it('draws nothing before the hit that starts them', () => {
		const grid = board_copy()

		cracks(draw_of(grid), CRACKS.from - 1)
		expect(grid).toStrictEqual(HOST.board)
	})

	it('cracks only the area once they have started', () => {
		const grid = board_copy()
		const { area_top, area_end } = HOST.layout

		cracks(draw_of(grid), CRACKS.from + CRACKS.rays)
		const rows = changed_rows(grid)

		expect(rows.length).toBeGreaterThan(0)
		expect(rows.every((y) => y >= area_top && y <= area_end)).toBe(true)
	})
})

describe('run_board_theme_rk800_break.spark', () => {
	it('styles the whole screen alike', () => {
		const grid = board_copy()

		spark(draw_of(grid))
		expect(new Set(grid.flat().map(([, style]) => style)).size).toBe(1)
	})
})

describe('run_board_theme_rk800_break.shards', () => {
	it('lands no shard on the notice or the progress row', () => {
		const grid = board_copy()
		const { notice, progress } = HOST.layout

		shards(draw_of(grid), SHARDS.spark)
		const rows = changed_rows(grid)

		expect(rows.length).toBeGreaterThan(0)
		expect(rows.filter((y) => y === notice.y || y === progress.y)).toStrictEqual([])
	})
})
