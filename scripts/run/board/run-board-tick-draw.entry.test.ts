import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_tick_draw } from './run-board-tick-draw'

// joshuafolkken/kit#8356: the matrix board draws its lamp panel as the idle rain, and its new rows decode
// on a terminal drawing color; elsewhere they type or show at once.

const { entry_of, has_lamps, has_rain } = run_board_tick_draw
const MATRIX = { types_rows: true, theme: 'matrix', is_tty: true } as const
const WARGAMES = { ...MATRIX, theme: 'wargames' } as const
const ONCE = '--once, --chat and a pipe'
const EVERY = '--every'

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_tick_draw.has_rain', () => {
	it('draws the matrix board’s lamp panel, as the idle rain, on a terminal drawing color', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_lamps(MATRIX)).toBe(true)
		expect(has_rain(MATRIX)).toBe(true)
	})

	it('runs no rain in the wargames board’s panel', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_rain(WARGAMES)).toBe(false)
	})

	it.each([
		[ONCE, { ...MATRIX, is_tty: false }],
		[EVERY, { ...MATRIX, types_rows: false }],
	])('runs none with %s', (_, ports) => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_rain(ports)).toBe(false)
	})

	it('runs none on a terminal drawing no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(has_rain(MATRIX)).toBe(false)
	})
})

describe('run_board_tick_draw.entry_of', () => {
	it('decodes the matrix board’s new rows on a terminal drawing color', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(entry_of(MATRIX)).toBe('decode')
	})

	it('types the wargames board’s new rows', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(entry_of(WARGAMES)).toBe('type')
	})

	it.each([
		[ONCE, { ...MATRIX, is_tty: false }],
		[EVERY, { ...MATRIX, types_rows: false }],
	])('shows the matrix board’s rows at once with %s', (_, ports) => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(entry_of(ports)).toBe('none')
	})

	it('shows the matrix board’s rows at once on a terminal drawing no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(entry_of(MATRIX)).toBe('none')
	})
})
