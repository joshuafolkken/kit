import { describe, expect, it } from 'vitest'
import { run_board_theme_flux_data } from './run-board-theme-flux-data'

// joshuafolkken/kit#8917: the BTTF theme's tables are the confirmed demo's.

const { COLORS, GEOMETRY, numbers_of, text_of } = run_board_theme_flux_data

describe('run_board_theme_flux_data', () => {
	it('writes a color as r;g;b', () => {
		expect(text_of({ r: 255, g: 70, b: 50 })).toBe('255;70;50')
	})

	it('reads a line of numbers, the negative ones too', () => {
		expect(numbers_of('1 2 2 1 -1 0')).toStrictEqual([1, 2, 2, 1, -1, 0])
	})

	it('paints the roles in the time circuits’ colors', () => {
		const body = '190;198;206'

		expect(COLORS).toStrictEqual({
			body,
			rule: '80;88;98',
			ok: '70;255;110',
			red: '255;70;50',
			warn: '255;190;40',
			hi: '235;255;252',
			type: body,
			notice: body,
			info: '130;190;255',
			idle: '110;118;128',
			human: '255;130;190',
		})
	})

	it('draws the figure seven rows tall, thirteen columns wide', () => {
		expect(GEOMETRY.picture).toHaveLength(7)
		expect(GEOMETRY.picture.every((line) => line.length === 13)).toBe(true)
		expect(GEOMETRY.slots).toHaveLength(7)
	})
})
