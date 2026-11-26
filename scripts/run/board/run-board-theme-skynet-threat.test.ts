import { describe, expect, it } from 'vitest'
import { run_board_theme_skynet_fixture } from './run-board-theme-skynet-fixture'
import { run_board_theme_skynet_threat } from './run-board-theme-skynet-threat'

// joshuafolkken/kit#8917: the TERMINATOR theme's NOTICE screens and the response list.

const { cursor_of, response_list, threat_header, threat_screen } = run_board_theme_skynet_threat
const { HOST, draw_at, row_text } = run_board_theme_skynet_fixture

// The NOTICE event's first tick after its text has typed, and `after` ticks on.
function typed_tick(after: number): number {
	const { s } = draw_at('n', 10)

	return s.notice.start + s.notice.total + after
}

describe('run_board_theme_skynet_threat', () => {
	it('walks the cursor after a wait, then settles on the second line', () => {
		expect(cursor_of(0)).toBe(-1)
		expect(cursor_of(12)).toBe(0)
		expect(cursor_of(28)).toBe(4)
		expect(cursor_of(44)).toBe(1)
		expect(cursor_of(100)).toBe(1)
	})

	it('assesses the threat while the notice types', () => {
		const draw = draw_at('n', 14)

		threat_screen(draw)

		expect(row_text(draw.grid, HOST.layout.area_top)).toContain(
			'PRIORITY OVERRIDE · THREAT ASSESSMENT',
		)
		expect(row_text(draw.grid, 7)).toContain('TARGET: NOTICE')
	})

	it('lists the possible responses once the notice has typed', () => {
		const draw = draw_at('n', typed_tick(20))

		response_list(draw)

		expect(row_text(draw.grid, 5)).toContain('POSSIBLE RESPONSE:')
		expect(row_text(draw.grid, 6)).toContain('RETRY THE GATE')
		expect(row_text(draw.grid, 10)).toContain('REVERT AND REFILE')
	})

	it('runs a ticker along the header', () => {
		const draw = draw_at('n', 14)

		threat_header(draw)

		expect(row_text(draw.grid, 0)).toContain(' · ')
		expect(row_text(draw.grid, 1)).toContain('AZM ')
	})
})
