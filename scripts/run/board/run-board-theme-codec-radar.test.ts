import { describe, expect, it } from 'vitest'
import { run_board_theme_codec_context } from './run-board-theme-codec-context'
import { run_board_theme_codec_radar } from './run-board-theme-codec-radar'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid } from './run-board-theme-host-types'

// joshuafolkken/kit#8917: the METAL GEAR theme's radar.

const { guards_of, is_on_ring, radar, radar_cell, radar_idle, view_of } =
	run_board_theme_codec_radar
const { HOST } = run_board_theme_host_fixture
const { row_of } = run_board_theme_host_grid
const { state_of } = run_board_theme_host_state
const IDLE = { notice: [], progress: [], row: [] }
const FRAME = '80;170;105'

function blank(rows: number, width: number): Grid {
	return Array.from({ length: rows }, () => row_of('', 'body', width))
}

function text_of(grid: Grid): Array<string> {
	return grid.map((row) => row.map(([ch]) => ch).join(''))
}

describe('run_board_theme_codec_radar.radar_cell', () => {
	const view = view_of(blank(7, 25), { x: 0, y: 0, w: 25, h: 7 }, 0)

	it('marks the player in the middle on a dotted field', () => {
		expect(radar_cell(view, 0, 11, 2)[0]).toBe('▲')
		expect(radar_cell(view, 0, 0, 0)[0]).toBe('·')
		expect(radar_cell(view, 0, 1, 0)[0]).toBe(' ')
	})

	it('fills a fully jammed radar with static', () => {
		expect('░▒▓█ ').toContain(radar_cell(view, 1, 11, 2)[0])
	})
})

describe('run_board_theme_codec_radar.guards_of', () => {
	it('patrols the top and bottom rows, and two more rows on a wide radar', () => {
		expect(guards_of(5, false).map(({ iy }) => iy)).toStrictEqual([0, 4])
		expect(guards_of(6, true).map(({ iy }) => iy)).toStrictEqual([0, 5, 1, 4])
	})

	it('draws a ring of cells half a cell either side of its radius, twice as wide', () => {
		const ring = { cx: 10, cy: 3, radius: 2 }

		expect(is_on_ring(ring, 14, 3)).toBe(true)
		expect(is_on_ring(ring, 10, 3)).toBe(false)
	})
})

describe('run_board_theme_codec_radar.radar', () => {
	const codec = run_board_theme_codec_context.codec_of(HOST.api)
	const box = { x: 0, y: 0, w: 25, h: 7 }

	it('frames the radar and puts the player and its guards in it', () => {
		const grid = blank(7, 25)

		radar(codec, { grid, s: state_of(HOST.layout, IDLE, 0), tick: 0 }, box, {
			jam: 0,
			is_contact: false,
			frame: FRAME,
		})

		expect(text_of(grid)[0]).toBe(`┌─ RADAR ${'─'.repeat(15)}┐`)
		expect(text_of(grid).join('')).toContain('▲')
		expect(text_of(grid).join('')).toContain('●')
	})

	it('sweeps a line across the idle radar, a dot trailing it', () => {
		const grid = blank(7, 25)

		radar(codec, { grid, s: state_of(HOST.layout, IDLE, 40), tick: 40 }, box, {
			jam: 0,
			is_contact: false,
			frame: FRAME,
		})
		radar_idle(grid, box, 40)

		// Tick 40 sweeps column 20 of the inside; its middle row has no guard on it.
		expect(text_of(grid)[3]?.slice(20, 23)).toBe('·│ ')
	})
})
