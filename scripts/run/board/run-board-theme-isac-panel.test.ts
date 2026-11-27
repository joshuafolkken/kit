import { describe, expect, it } from 'vitest'
import { run_board_theme_isac_data } from './run-board-theme-isac-data'
import { run_board_theme_isac_panel } from './run-board-theme-isac-panel'
import { run_board_theme_rk800_fixture } from './run-board-theme-rk800-fixture'

// joshuafolkken/kit#9096: the isac theme's panel — when a transmission takes it, the waveform's
// bar heights, the idle status block with its scanner, and the transmission with its brackets.

const { is_receiving, panel, wave_height } = run_board_theme_isac_panel
const { SCAN, STATUS, TX } = run_board_theme_isac_data
const { HOST, draw_at, panel_text, state_at } = run_board_theme_rk800_fixture
const TYPING = 15
const RECEIVED = 60
const IDLE_TICK = 30
const BARS = 200
const TICKS_HELD = 4
const LAST_ROW = 5

function panel_rows(key: 'i' | 'p', tick: number): Array<string> {
	const draw = draw_at(key, tick)

	panel(draw)

	return Array.from({ length: LAST_ROW }, (_, y) => panel_text(draw.grid, y))
}

describe('run_board_theme_isac_panel.is_receiving', () => {
	it('is true while a PROGRESS types and for a moment after', () => {
		expect(is_receiving(state_at('p', TYPING))).toBe(true)
		expect(is_receiving(state_at('p', RECEIVED))).toBe(true)
	})

	it('is false before any PROGRESS and long after it', () => {
		expect(is_receiving(state_at('p', 0))).toBe(false)
		expect(is_receiving(state_at('i', IDLE_TICK))).toBe(false)
		expect(is_receiving(state_at('p', BARS * TICKS_HELD))).toBe(false)
	})
})

describe('run_board_theme_isac_panel.wave_height', () => {
	it('stays between none and twice the glyphs’ count', () => {
		const heights = Array.from({ length: BARS }, (_, index) => wave_height(index, 0))

		expect(Math.min(...heights)).toBeGreaterThanOrEqual(0)
		expect(Math.max(...heights)).toBeLessThan(TX.levels.length * 2)
		expect(new Set(heights).size).toBeGreaterThan(1)
	})

	it('holds a bar for the hold’s ticks, then changes it', () => {
		const held = Array.from({ length: TX.hold }, (_, tick) => wave_height(1, tick))
		const moved = Array.from({ length: BARS }, (_, index) => wave_height(index, TX.hold))

		expect(new Set(held).size).toBe(1)
		expect(moved).not.toStrictEqual(
			Array.from({ length: BARS }, (_, index) => wave_height(index, 0)),
		)
	})
})

describe('run_board_theme_isac_panel.panel (idle)', () => {
	it('shows the status block', () => {
		const text = panel_rows('i', IDLE_TICK).join('\n')

		expect(text).toContain('NETWORK')
		expect(text).toContain('ONLINE')
		expect(text).toContain('ARMOR')
		expect(text).toContain('STANDBY')
		expect(text).toContain(String(HOST.layout.lane_rows.length || STATUS.sample_agents))
	})

	it('frames the scanner', () => {
		expect(panel_rows('i', IDLE_TICK)[0]).toContain(SCAN.label)
	})
})

describe('run_board_theme_isac_panel.panel (receiving)', () => {
	it('announces the transmission while it types, with the brackets closing', () => {
		const rows = panel_rows('p', TYPING)

		expect(rows[TX.label_row]).toContain('INCOMING TRANSMISSION')
		expect(rows[TX.top_row]).toContain('┌─')
		expect(rows[TX.bottom_row]).toContain('─┘')
	})

	it('reports it received after it, over a flat waveform', () => {
		const rows = panel_rows('p', RECEIVED)

		expect(rows[TX.label_row]).toContain('TRANSMISSION RECEIVED')
		expect(rows[TX.wave_row]).not.toContain(TX.levels.charAt(1))
	})
})
