import { describe, expect, it } from 'vitest'
import { run_board_theme_magi_data } from './run-board-theme-magi-data'
import { run_board_theme_magi_draw } from './run-board-theme-magi-draw'
import { run_board_theme_magi_fixture } from './run-board-theme-magi-fixture'

// joshuafolkken/kit#8917: the MAGI theme's small drawing pieces.

const { BAND } = run_board_theme_magi_data
const { band_cell, band_row, clock_text, is_lit, link_pair, magi_box } = run_board_theme_magi_draw
const { fresh_grid, row_text } = run_board_theme_magi_fixture

describe('run_board_theme_magi_draw', () => {
	it('lights a blink for its first ticks of every cycle', () => {
		const beat = { every: 6, on: 3 }

		expect([0, 2, 3, 5, 6].map((tick) => is_lit(tick, beat))).toStrictEqual([
			true,
			true,
			false,
			false,
			true,
		])
	})

	it('shows the clock', () => {
		expect(clock_text(1.2)).toBe('00:01:20')
		expect(clock_text(12.345)).toBe('00:12:35')
	})

	it('repeats the band either way', () => {
		expect(band_cell(-1)).toBe(BAND.at(-1))
		expect(band_cell(BAND.length)).toBe(BAND[0])
	})

	it('lays a band only between its columns', () => {
		const grid = fresh_grid()

		band_row(grid, 199, { y: 3, dir: 1, tick: 0, x0: 2, x1: 5 })

		expect(row_text(grid, 3).slice(2, 5)).toBe('◢◤◢')
	})
})

describe('run_board_theme_magi_draw.magi_box', () => {
	it('draws a panel with its name in the frame and its status centered', () => {
		const grid = fresh_grid()

		magi_box(
			grid,
			{ name: 'CASPER·3', x: 0, y: 30, w: 14 },
			{ text: 'ONLINE', frame: '1;2;3', fill: '' },
		)

		expect(row_text(grid, 30).slice(0, 14)).toBe('┌CASPER·3────┐')
		expect(row_text(grid, 31).slice(0, 14)).toBe('│   ONLINE   │')
		expect(row_text(grid, 32).slice(0, 14)).toBe('└────────────┘')
	})
})

describe('run_board_theme_magi_draw.link_pair', () => {
	it('points a lit link pair in toward the middle, an unlit one as dots', () => {
		const grid = fresh_grid()

		link_pair(grid, 30, { left: 0, right: 2 }, true)
		link_pair(grid, 31, { left: 0, right: 2 }, false)

		expect([row_text(grid, 30).charAt(0), row_text(grid, 30).charAt(2)]).toStrictEqual(['▸', '◂'])
		expect([row_text(grid, 31).charAt(0), row_text(grid, 31).charAt(2)]).toStrictEqual(['·', '·'])
	})
})
