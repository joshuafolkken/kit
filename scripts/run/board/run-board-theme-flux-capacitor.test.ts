import { describe, expect, it } from 'vitest'
import { run_board_theme_flux_capacitor } from './run-board-theme-flux-capacitor'

// joshuafolkken/kit#8917: the BTTF theme's flux capacitor runs in, pulses and floods as the demo did.

const { LAMPS, flood_ground, flux_cells, lamp_look, pulse_of } = run_board_theme_flux_capacitor
const ORIGIN = { row: 10, column: 50 }

describe('run_board_theme_flux_capacitor', () => {
	it('finds the figure’s ten lamps, the middle one the fourth step', () => {
		expect(LAMPS).toHaveLength(10)
		expect(LAMPS.filter((lamp) => lamp.step === 3)).toStrictEqual([{ row: 3, column: 6, step: 3 }])
	})

	it('lights the lamps of the step the beat is on', () => {
		expect(lamp_look(0, 0, 0).text).toBe('●')
		expect(lamp_look(0, 1, 0).text).toBe('∙')
		expect(lamp_look(4, 1, 0).text).toBe('●')
	})

	it('pulses once every three seconds, then sparks', () => {
		expect(pulse_of(0, 0)).toStrictEqual({ is_pulse: true, is_spark: false })
		expect(pulse_of(12, 0)).toStrictEqual({ is_pulse: false, is_spark: true })
		expect(pulse_of(30, 0)).toStrictEqual({ is_pulse: false, is_spark: false })
	})

	it('floods white, then grey', () => {
		expect(flood_ground(0)).toStrictEqual({ r: 255, g: 255, b: 255 })
		expect(flood_ground(20)).toStrictEqual({ r: 78, g: 84, b: 96 })
	})

	it('draws the bar and the lamps, a spark after the pulse, and a box when flooded', () => {
		expect(flux_cells(ORIGIN, 30, 0, undefined)).toHaveLength(19)
		expect(flux_cells(ORIGIN, 12, 0, undefined)).toHaveLength(22)
		expect(flux_cells(ORIGIN, 0, 0, { flood: 5, is_orange: false })).toHaveLength(7 * 15 + 19)
	})
})
