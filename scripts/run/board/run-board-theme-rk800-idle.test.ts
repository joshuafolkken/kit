import { describe, expect, it } from 'vitest'
import type { ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid } from './run-board-theme-host-types'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_idle } from './run-board-theme-rk800-idle'

// joshuafolkken/kit#9096: the rk800 theme's quiet idle effects — the scan band passing down the
// board, the glints along the rules and the one-letter instability glitch, each on its own beat of
// the band's cycle.

const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state
const { glitch, rule_glints, scan_band, scan_tint } = run_board_theme_rk800_idle
const { SCAN } = run_board_theme_rk800_data
const BAND_FROM = SCAN.every - SCAN.ticks
const CYCLE = Array.from({ length: SCAN.every }, (_, tick) => tick)

function board_copy(): Grid {
	return HOST.board.map((row) => row.map((cell): Cell => [cell[0], cell[1]]))
}

function draw_at(tick: number): ThemeDraw {
	return { api: HOST.api, grid: board_copy(), s: state_of(HOST.layout, HOST.events.i, tick), tick }
}

function changed_in_row(row: Array<Cell>, y: number): number {
	const was = HOST.board[y] ?? []

	return row.filter((cell, x) => cell.join('\n') !== was[x]?.join('\n')).length
}

function changed_cells(grid: Grid): number {
	return grid.reduce((sum, row, y) => sum + changed_in_row(row, y), 0)
}

// The ticks of the cycle on which `layer` changes the board.
function ticks_drawn(layer: (draw: ThemeDraw) => void): Array<number> {
	return CYCLE.filter((tick) => {
		const draw = draw_at(tick)

		layer(draw)

		return changed_cells(draw.grid) > 0
	})
}

describe('run_board_theme_rk800_idle.scan_band', () => {
	it('passes only in the last ticks of the cycle', () => {
		expect([scan_band(HOST.layout, BAND_FROM - 1), scan_band(HOST.layout, 0)]).toStrictEqual([
			undefined,
			undefined,
		])
		expect(scan_band(HOST.layout, BAND_FROM)).toBe(-SCAN.reach)
	})

	it('runs down the board as the band passes', () => {
		const top = scan_band(HOST.layout, BAND_FROM) ?? 0
		const lower = scan_band(HOST.layout, SCAN.every - 1) ?? 0

		expect(lower).toBeGreaterThan(top)
	})
})

describe('run_board_theme_rk800_idle.scan_tint', () => {
	it('is whole on the band middle row and none outside its reach', () => {
		const tick = SCAN.every - SCAN.ticks / 2
		const middle = scan_band(HOST.layout, tick) ?? 0

		expect(scan_tint(HOST.layout, middle, tick)).toBe(1)
		expect(scan_tint(HOST.layout, middle + SCAN.reach, tick)).toBe(0)
		expect(scan_tint(HOST.layout, middle, 0)).toBe(0)
	})
})

describe('run_board_theme_rk800_idle.rule_glints', () => {
	it('glints the rules on some ticks of the cycle, never while the band passes', () => {
		const ticks = ticks_drawn(rule_glints)

		expect(ticks.length).toBeGreaterThan(0)
		expect(ticks.every((tick) => tick < BAND_FROM)).toBe(true)
	})
})

describe('run_board_theme_rk800_idle.glitch', () => {
	const ticks = ticks_drawn(glitch)

	it('changes one letter for a few consecutive ticks once a cycle', () => {
		const [first = 0] = ticks

		expect(ticks.length).toBeGreaterThan(0)
		expect(ticks).toStrictEqual(ticks.map((_, index) => first + index))
	})

	it('changes a single cell', () => {
		const [tick = 0] = ticks
		const draw = draw_at(tick)

		glitch(draw)
		expect(changed_cells(draw.grid)).toBe(1)
	})
})
