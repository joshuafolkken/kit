import { describe, expect, it } from 'vitest'
import { run_board_theme_codec_context } from './run-board-theme-codec-context'
import { run_board_theme_codec_unit } from './run-board-theme-codec-unit'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Grid } from './run-board-theme-host-types'

// joshuafolkken/kit#8917: the codec on its own, as the METAL GEAR opening and ending draw it.

const { codec_unit, codec_window } = run_board_theme_codec_unit
const { HOST } = run_board_theme_host_fixture
const { row_of } = run_board_theme_host_grid
const codec = run_board_theme_codec_context.codec_of(HOST.api)
const LOOK = { label: 'PTT', is_lit: true, level: 10, freq: '140.85' }

function blank(): Grid {
	return Array.from({ length: HOST.layout.h }, () => row_of('', 'body', HOST.layout.w))
}

function text_of(grid: Grid): Array<string> {
	return grid.map((row) => row.map(([ch]) => ch).join(''))
}

describe('run_board_theme_codec_unit.codec_unit', () => {
	it('frames the codec with PTT over the meter and MEMORY under it', () => {
		const grid = blank()
		const { y } = codec.codec_at

		codec_unit(codec, grid, LOOK)
		const rows = text_of(grid)

		expect(rows[y]).toContain('┌─ CODEC ─')
		expect(rows[y + 1]).toContain('   PTT   ')
		expect(rows[y + 8]).toContain('  MEMORY  ')
		expect(rows[y + 9]).toContain('└──')
	})
})

describe('run_board_theme_codec_unit.codec_window', () => {
	it('shows the board beyond the window and a bright line at its edge', () => {
		const grid = blank()
		const under = blank()
		const { x, y } = codec.codec_at

		codec_unit(codec, grid, LOOK)
		codec_window(codec, grid, under, 2)
		const rows = text_of(grid)

		expect(rows[y]?.slice(x, x + 58)).toBe(' '.repeat(58))
		expect(rows[y + 3]?.slice(x, x + 58)).toBe('━'.repeat(58))
		expect(rows[y + 5]?.slice(x, x + 58)).not.toBe(' '.repeat(58))
	})

	it('draws no edge once the window is fully open', () => {
		const grid = blank()

		codec_unit(codec, grid, LOOK)
		const opened = text_of(grid)

		codec_window(codec, grid, blank(), 5)

		expect(text_of(grid)).toStrictEqual(opened)
	})
})
