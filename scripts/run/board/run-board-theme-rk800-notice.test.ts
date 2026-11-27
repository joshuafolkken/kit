import { describe, expect, it } from 'vitest'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_notice } from './run-board-theme-rk800-notice'

// joshuafolkken/kit#9096: the rk800 theme's NOTICE tables — how they line up with the wall's.

const { CRACKS, OBJECTIVE, ODDS, PROMPT } = run_board_theme_rk800_notice
const { WALL } = run_board_theme_rk800_data

describe('run_board_theme_rk800_notice.CRACKS', () => {
	it('starts the cracks on one of the wall hits', () => {
		expect(WALL.hits).toContain(CRACKS.from)
	})
})

describe('run_board_theme_rk800_notice.PROMPT', () => {
	it('fits both choices in the prompt label width', () => {
		expect(
			[PROMPT.obey, PROMPT.ignore].map((label) => label.length <= PROMPT.label_w),
		).toStrictEqual([true, true])
	})

	it('pulses only once the list has faded up', () => {
		expect(PROMPT.pulse_from).toBeGreaterThanOrEqual(PROMPT.list_after + PROMPT.hold)
	})
})

describe('run_board_theme_rk800_notice.OBJECTIVE', () => {
	it('stamps both lines whole before the objective leaves', () => {
		const letters = OBJECTIVE.bold_after + OBJECTIVE.bold.length
		const typed_by = OBJECTIVE.from + Math.ceil(letters / OBJECTIVE.pace)

		expect(typed_by).toBeLessThan(OBJECTIVE.until)
	})
})

describe('run_board_theme_rk800_notice.ODDS', () => {
	it('falls below where it rises back to, which is under its start', () => {
		expect(ODDS.low).toBeLessThan(ODDS.rise)
		expect(ODDS.rise).toBeLessThanOrEqual(ODDS.start)
	})
})
