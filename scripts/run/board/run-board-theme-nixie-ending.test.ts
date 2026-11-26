import { describe, expect, it } from 'vitest'
import { run_board_theme_nixie_ending } from './run-board-theme-nixie-ending'

// joshuafolkken/kit#8917: STEINS;GATE's ending — a tube spins, locks white, glows, cools and goes
// dark; a cell of the board breaks up at its own moment and goes out.

const { SG_END, cooling_look, ended_cell } = run_board_theme_nixie_ending
const WHITE = '255;255;255'
const AMBER = '255;150;40'
const EMBER = '75;30;8'

describe('run_board_theme_nixie_ending.cooling_look', () => {
	it('spins, locks white, glows amber, then is gone', () => {
		expect(cooling_look(SG_END.lock - 1, 0)?.glow).toBe('255;200;120')
		expect(cooling_look(SG_END.lock, 0)).toStrictEqual({ ch: '1', glow: WHITE, ghost: EMBER })
		expect(cooling_look(SG_END.cool, 0)?.glow).toBe(AMBER)
		expect(cooling_look(SG_END.cool + SG_END.cool_ticks, 0)).toBeUndefined()
	})

	it('never spins the point: it shows white until its lock', () => {
		expect(cooling_look(0, 1)).toStrictEqual({ ch: '.', glow: WHITE, ghost: EMBER })
		expect(cooling_look(SG_END.lock + 4, 1)?.glow).toBe(AMBER)
	})
})

describe('run_board_theme_nixie_ending.ended_cell', () => {
	it('keeps a cell until its moment and blanks it once gone', () => {
		expect(ended_cell(-1, 3, 4, 'x')).toBeUndefined()
		expect(ended_cell(SG_END.dissolve + 30, 3, 4, 'x')).toStrictEqual([' ', 'body'])
		expect(ended_cell(SG_END.dissolve, 3, 4, ' ')).toStrictEqual([' ', 'body'])
	})
})
