import { describe, expect, it } from 'vitest'
import { run_board_theme_codec_context } from './run-board-theme-codec-context'
import { run_board_theme_codec_panel } from './run-board-theme-codec-panel'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid, ThemeTimeline } from './run-board-theme-host-types'

// joshuafolkken/kit#8917: the METAL GEAR theme's panel, marks and idle sweep.

const { is_quiet, mark, mission_clock, scanned_freq } = run_board_theme_codec_panel
const { HOST } = run_board_theme_host_fixture
const { row_of } = run_board_theme_host_grid
const { state_of } = run_board_theme_host_state
const IDLE: ThemeTimeline = { notice: [], progress: [], row: [] }
const NOTICE: ThemeTimeline = { notice: [{ start: 0, text: 'NOTICE' }], progress: [], row: [] }

function blank(): Grid {
	return Array.from({ length: HOST.layout.h }, () => row_of('', 'body', HOST.layout.w))
}

describe('run_board_theme_codec_panel standby', () => {
	it('runs the mission clock from 00:14:32, a second every 20 ticks', () => {
		expect(mission_clock(0)).toBe('00:14:32')
		expect(mission_clock(20 * 3600)).toBe('01:14:32')
	})

	it('scans the stored channels every 120 ticks, dialling each in', () => {
		expect(scanned_freq(14)).toBe('140.85')
		expect(scanned_freq(120 + 14)).toBe('141.12')
		expect(scanned_freq(120)).toMatch(/^\d{3}\.\d{2}$/u)
	})

	it('is quiet only when nothing types and the last event ended 150 ticks ago', () => {
		expect(is_quiet(state_of(HOST.layout, IDLE, 0))).toBe(true)
		expect(is_quiet(state_of(HOST.layout, NOTICE, 0))).toBe(false)
	})
})

describe('run_board_theme_codec_panel.mark', () => {
	const codec = run_board_theme_codec_context.codec_of(HOST.api)

	it('blinks "!" four columns before the notice while it starts', () => {
		const grid = blank()
		const state = state_of(HOST.layout, NOTICE, 1)
		const { y, x } = state.notice.span

		mark(grid, state.notice, 1, codec.alert_mark)

		expect(
			grid[y]
				?.slice(x - 4, x - 1)
				.map(([ch]) => ch)
				.join(''),
		).toBe(' ! ')
	})

	it('draws nothing before its row starts', () => {
		const grid = blank()
		const state = state_of(HOST.layout, IDLE, 1)

		mark(grid, state.row, 1, codec.query_mark)

		expect(grid).toStrictEqual(blank())
	})
})
