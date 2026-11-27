import { describe, expect, it } from 'vitest'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'

const { COLORS, GAMES, LEVEL_INKS, ORDER, SHADES, SPARK } = run_board_theme_wopr_data
const { STRIP_RANK, THE_CODE, WORLD } = run_board_theme_wopr_data
// A style's background as 'r;g;b'.
const BACKGROUND = /\[48;2;(\d+;\d+;\d+)m/u
// The white frames' background, left as it was.
const SPARK_WHITE = '255;255;235'

function sorted(text: string): string {
	return Array.from(text, (ch) => ch)
		.toSorted((first, second) => first.localeCompare(second))
		.join('')
}

function filled<T>(length: number, value: T): Array<T> {
	return Array.from({ length }, () => value)
}

describe('run_board_theme_wopr_data', () => {
	it('paints the body, the typed text and the notice in the phosphor cyan', () => {
		expect([COLORS.body, COLORS.type, COLORS.notice]).toStrictEqual(filled(3, '62;236;225'))
	})

	it('locks every position of CPE 1704 TKS once, and every letter of CPE once', () => {
		expect(THE_CODE).toBe('CPE1704TKS')
		expect(sorted(ORDER)).toBe('0123456789')
		expect(sorted(STRIP_RANK)).toBe('012')
	})

	it('plays each game over all nine cells', () => {
		expect(GAMES.map((game) => sorted(game))).toStrictEqual(filled(GAMES.length, '012345678'))
	})

	it('has a lamp shade a row, a red a level from 1 to 3, and a 57 by 7 world', () => {
		expect(SHADES).toHaveLength(7)
		expect(LEVEL_INKS).toHaveLength(3)
		expect(WORLD.map((line) => line.length)).toStrictEqual(filled(7, 57))
	})
})

// joshuafolkken/kit#9137: the colors measured on the film.
describe('run_board_theme_wopr_data — the film’s colors', () => {
	it('lights the lamp rows yellow, yellow, yellow, red, red, yellow, red', () => {
		const [yellow] = SHADES
		const red = SHADES.at(-1)

		expect(yellow).toStrictEqual({
			lit: '\u{1B}[38;2;255;214;10m',
			out: '\u{1B}[2m\u{1B}[38;2;128;107;5m',
		})
		expect(red).toStrictEqual({
			lit: '\u{1B}[38;2;255;69;58m',
			out: '\u{1B}[2m\u{1B}[38;2;128;38;40m',
		})
		expect(SHADES).toStrictEqual([yellow, yellow, yellow, red, red, yellow, red])
	})

	it('floods the spark white, white, lavender, dim lavender', () => {
		expect(SPARK.map((style) => BACKGROUND.exec(style)?.[1])).toStrictEqual([
			SPARK_WHITE,
			SPARK_WHITE,
			'228;227;255',
			'148;148;166',
		])
	})
})
