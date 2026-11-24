import { describe, expect, it } from 'vitest'
import { run_board_sgr } from './run-board-sgr'

// joshuafolkken/kit#8826: SGR runs reduced to the style they leave.

const { after } = run_board_sgr
const ESC = '\u{1B}'
const TEAL = '38;2;31;118;113'
// Past the steps the reducer keeps known, so it has forgotten them at least once.
const MANY_STEPS = 5000

function style_after(...runs: ReadonlyArray<string>): string {
	let style = ''

	for (const parameters of runs) style = after(style, parameters)

	return style
}

describe('run_board_sgr.after', () => {
	it('keeps one color however often it is reset and set again', () => {
		const repeated = Array.from({ length: 8 }, () => ['39', TEAL]).flat()

		expect(style_after(TEAL, ...repeated)).toBe(`${ESC}[${TEAL}m`)
	})

	it('keeps the last foreground and the background beside it', () => {
		expect(style_after('31', '44', '32')).toBe(`${ESC}[32m${ESC}[44m`)
	})

	it('keeps a 24-bit and a 256-color group whole within one sequence', () => {
		expect(style_after(`1;${TEAL};48;5;17`)).toBe(`${ESC}[1m${ESC}[${TEAL}m${ESC}[48;5;17m`)
	})

	it('clears everything on a reset, an empty one included', () => {
		expect(style_after('1', TEAL, '0')).toBe('')
		expect(style_after('1', TEAL, '')).toBe('')
	})

	it('clears bold and dim on 22 and the colors on 39 and 49', () => {
		expect(style_after('1', '2', '4', '22')).toBe(`${ESC}[4m`)
		expect(style_after('31', '41', '39', '49')).toBe('')
	})

	it('answers a step it already took as it did the first time', () => {
		const first = style_after('1', TEAL, '44')

		expect(style_after('1', TEAL, '44')).toBe(first)
		expect(first).toBe(`${ESC}[1m${ESC}[${TEAL}m${ESC}[44m`)
	})

	it('still reduces each step once it has forgotten the steps it knew', () => {
		const colors = Array.from({ length: MANY_STEPS }, (_, index) => `38;5;${String(index)}`)

		expect(style_after('1', ...colors)).toBe(`${ESC}[1m${ESC}[38;5;${String(MANY_STEPS - 1)}m`)
		expect(style_after('1', TEAL)).toBe(`${ESC}[1m${ESC}[${TEAL}m`)
	})
})
