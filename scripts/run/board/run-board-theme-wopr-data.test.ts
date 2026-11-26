import { describe, expect, it } from 'vitest'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'

const { COLORS, GAMES, LEVEL_INKS, ORDER, SHADES, STRIP_RANK, THE_CODE, WORLD } =
	run_board_theme_wopr_data

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
