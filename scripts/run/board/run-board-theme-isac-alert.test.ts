import { describe, expect, it } from 'vitest'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import { run_board_theme_isac_alert } from './run-board-theme-isac-alert'
import { run_board_theme_isac_data } from './run-board-theme-isac-data'
import { run_board_theme_rk800_fixture } from './run-board-theme-rk800-fixture'

// joshuafolkken/kit#9096: the isac theme's NOTICE — when it plays, how fast its pulses run, the
// hazard stripes and the banner in the area, and every orange flipping to red from the peak.

const { alert_area, is_alert, pulse_phase, red_flip, reddened } = run_board_theme_isac_alert
const { ALERT, INKS, RED_OF, RGB } = run_board_theme_isac_data
const { PEAK_TICKS } = run_board_theme_host_state
const { ESC } = run_board_theme_host_grid
const { HOST, draw_at, row_text, state_at } = run_board_theme_rk800_fixture
const TYPING = 50
const PEAKED = 100
const AFTER_PLAY = 200
const PLAYED_OUT = 400
const TYPING_START = 10

function area_text(tick: number): string {
	const draw = draw_at('n', tick)

	alert_area(draw)

	return draw.grid.map((_, y) => row_text(draw.grid, y)).join('\n')
}

describe('run_board_theme_isac_alert.is_alert', () => {
	it('plays through the build and the play-out, not before or after', () => {
		expect(is_alert(state_at('n', 0))).toBe(false)
		expect(is_alert(state_at('n', TYPING))).toBe(true)
		expect(is_alert(state_at('n', PEAKED))).toBe(true)
		expect(is_alert(state_at('n', PLAYED_OUT))).toBe(false)
		expect(is_alert(state_at('i', TYPING))).toBe(false)
	})
})

describe('run_board_theme_isac_alert.pulse_phase', () => {
	it('builds slowly while the notice types and rushes into the peak', () => {
		const early = pulse_phase(state_at('n', TYPING_START + 1), TYPING_START + 1)
		const late = pulse_phase(state_at('n', TYPING), TYPING)

		expect(early).toBeCloseTo(1 / ALERT.slow + (1 / PEAK_TICKS) ** 2 * ALERT.rush)
		expect(late).toBeGreaterThan(early)
	})

	it('goes on steadily after the peak', () => {
		const first = pulse_phase(state_at('n', PEAKED), PEAKED)
		const next = pulse_phase(state_at('n', PEAKED + 1), PEAKED + 1)

		expect(next - first).toBeCloseTo(1 / ALERT.after)
	})
})

describe('run_board_theme_isac_alert.reddened', () => {
	it('turns a role into the red theme’s role', () => {
		expect(reddened('body')).not.toBe('body')
		expect(reddened('body')).toContain(RGB.red)
	})

	it('turns each of the theme’s oranges inside a raw style to its red', () => {
		for (const [from, to] of RED_OF) {
			expect(reddened(`${ESC}38;2;${from}m`)).toBe(`${ESC}38;2;${to}m`)
		}
	})

	it('leaves a raw style without an orange as it is', () => {
		expect(reddened(INKS.WARNING)).toBe(INKS.WARNING)
	})
})

describe('run_board_theme_isac_alert.alert_area', () => {
	it('marches the hazard stripes and labels the anomaly while the notice builds', () => {
		expect(area_text(TYPING)).toContain(ALERT.stripes.trim().charAt(0))
		expect(area_text(TYPING)).toContain(ALERT.build_label)
	})

	it('shows the WARNING banner from the peak', () => {
		expect(area_text(PEAKED)).not.toContain(ALERT.build_label)
		expect(area_text(PEAKED)).toContain(ALERT.banner)
	})
})

describe('run_board_theme_isac_alert.red_flip', () => {
	it('leaves the board orange while the notice types', () => {
		const draw = draw_at('n', TYPING)

		red_flip(draw)

		expect(draw.grid).toStrictEqual(draw_at('n', TYPING).grid)
	})

	it('turns the board right of the drain column red from the peak', () => {
		const draw = draw_at('n', PEAKED)
		const last = HOST.layout.w - 1
		const cell = draw.grid[0]?.[last] ?? ['', '']

		red_flip(draw)

		expect(draw.grid[0]?.[last]?.[1]).toBe(reddened(cell[1]))
	})

	it('leaves the board as it is once the play-out is over', () => {
		const draw = draw_at('n', AFTER_PLAY)

		red_flip(draw)

		expect(draw.grid).toStrictEqual(draw_at('n', AFTER_PLAY).grid)
	})
})
