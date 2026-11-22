import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_colon } from './run-board-colon'
import { run_board_tint } from './run-board-tint'

// joshuafolkken/kit#8673: the bttf theme's time circuits over the header's clock rows, and its dim.

const { circuit_cells, plain_drawn, lit, open_of } = run_board_tint
const ESC = '\u{1B}['
const DESTINATION = `${ESC}38;2;255;70;50m`
const PRESENT = `${ESC}38;2;70;255;110m`
const DEPARTED = `${ESC}38;2;255;190;40m`
const DEFAULT_FOREGROUND = `${ESC}39m`
const RED = `${ESC}31m`
const DIM = `${ESC}2m`
const INTENSITY_OFF = `${ESC}22m`
const DIM_GREY = `${ESC}38;2;105;109;113m`
const SLATE = `${ESC}38;2;80;88;98m`
const CELLS = ['finish', 'now', 'start']

beforeEach(() => {
	vi.stubEnv('FORCE_COLOR', '3')
	vi.stubEnv('NO_COLOR', undefined)
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_tint.circuit_cells', () => {
	it.each([[undefined], ['wargames'], ['matrix']] as const)(
		'leaves the cells as they are in %s',
		(theme) => {
			expect(circuit_cells(theme, CELLS)).toStrictEqual(CELLS)
		},
	)

	it('draws each bttf row in its circuit', () => {
		expect(circuit_cells('bttf', CELLS)).toStrictEqual([
			`${DESTINATION}finish${DEFAULT_FOREGROUND}`,
			`${PRESENT}now${DEFAULT_FOREGROUND}`,
			`${DEPARTED}start${DEFAULT_FOREGROUND}`,
		])
	})

	it('keeps a color the frame gave and resumes the circuit after it', () => {
		const [drawn] = circuit_cells('bttf', [`a ${RED}b${DEFAULT_FOREGROUND} c`])

		expect(drawn).toBe(`${DESTINATION}a ${RED}b${DESTINATION} c${DEFAULT_FOREGROUND}`)
	})

	it('draws no escape where stdout draws no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(circuit_cells('bttf', CELLS)).toStrictEqual(CELLS)
	})
})

describe('run_board_tint dark colon', () => {
	it('dims a colon in a circuit to 30% of its color', () => {
		expect(run_board_colon.dark_style(DESTINATION)).toBe(`${DESTINATION}${ESC}38;2;77;21;15m`)
		expect(run_board_colon.dark_style(PRESENT)).toBe(`${PRESENT}${ESC}38;2;21;77;33m`)
		expect(run_board_colon.dark_style(DEPARTED)).toBe(`${DEPARTED}${ESC}38;2;77;57;12m`)
	})
})

describe('run_board_tint.plain_drawn', () => {
	const PAINTS = {
		dim: { rgb: '105;109;113', named: 'gray' },
		rule: { rgb: '80;88;98', named: 'gray' },
	} as const

	it('draws an uncolored run of rule glyphs in the rule paint', () => {
		expect(plain_drawn(PAINTS, 'a───b')).toBe(`a${SLATE}───${DEFAULT_FOREGROUND}b`)
	})

	it('draws uncolored dim text in the dim paint in place of the dim attribute', () => {
		expect(plain_drawn(PAINTS, `a${DIM}b${INTENSITY_OFF}c`)).toBe(
			`a${DIM}${INTENSITY_OFF}${DIM_GREY}b${DEFAULT_FOREGROUND}${DIM}${INTENSITY_OFF}c`,
		)
	})

	it('leaves text the frame colored', () => {
		const line = `${RED}${DIM}b──${INTENSITY_OFF}${DEFAULT_FOREGROUND}`

		expect(plain_drawn(PAINTS, line)).toBe(line)
	})
})

describe('run_board_tint.lit', () => {
	it('opens the color over the line and resumes it after a reset', () => {
		expect(lit(open_of('red'), `a${ESC}0mb`)).toBe(`${RED}a${ESC}0m${RED}b${DEFAULT_FOREGROUND}`)
	})

	it('leaves the line where there is no color to open', () => {
		expect(lit('', 'a')).toBe('a')
	})
})
