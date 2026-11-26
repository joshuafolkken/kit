import { describe, expect, it } from 'vitest'
import { run_board_theme_nixie_data } from './run-board-theme-nixie-data'

// joshuafolkken/kit#8917: STEINS;GATE's tables — the world lines cycle, colors mix, and the D-mail
// carries the notice's words cut to its bytes.

const { ALPHA_LINES, MAIL_BODY, MAIL_BYTES, SEGMENTS, SHIFTS, nth } = run_board_theme_nixie_data

describe('run_board_theme_nixie_data.nth', () => {
	it('cycles through the list', () => {
		expect([0, 5, 6].map((index) => nth(ALPHA_LINES, index))).toStrictEqual([
			'0.571024',
			'0.337187',
			'0.571024',
		])
	})
})

describe('run_board_theme_nixie_data tables', () => {
	it('cuts the notice after its separator to a D-mail of 36 bytes', () => {
		expect(MAIL_BODY).toHaveLength(MAIL_BYTES)
		expect(MAIL_BODY.trimEnd()).toBe('#8897 Gate red — lint 2 errors')
	})

	it('lights every bar on an eight and two on a one', () => {
		expect([SEGMENTS[8], SEGMENTS[1]]).toStrictEqual(['a b c d e f g', 'b c'])
	})

	it('shifts hardest on a notice', () => {
		expect(SHIFTS['notice']).toStrictEqual({ power: 1.6, ticks: 26, flashes: 3, flash_every: 3 })
	})
})
