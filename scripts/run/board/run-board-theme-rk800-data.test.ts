import { describe, expect, it } from 'vitest'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'

// joshuafolkken/kit#9096: the rk800 theme's first tables — the invariants its parts rely on.

const { CHOICES, CURSOR, MONTHS, ORDINALS, RGB, WALL, theme_colors } = run_board_theme_rk800_data
const RGB_TRIPLE = /^(?:\d{1,3});(?:\d{1,3});(?:\d{1,3})$/u
const CHANNEL_MAX = 255
const HALF = 2

function is_rgb(color: string): boolean {
	return RGB_TRIPLE.test(color) && color.split(';').every((part) => Number(part) <= CHANNEL_MAX)
}

describe('run_board_theme_rk800_data.RGB', () => {
	it('holds every color as an r;g;b triple', () => {
		expect(Object.values(RGB).filter((color) => !is_rgb(color))).toStrictEqual([])
	})
})

describe('run_board_theme_rk800_data.theme_colors', () => {
	it('gives every role an r;g;b color', () => {
		expect(Object.values(theme_colors).filter((color) => !is_rgb(color))).toStrictEqual([])
	})

	it('draws the notice role in the order color', () => {
		expect(theme_colors.notice).toBe(RGB.order)
	})
})

describe('run_board_theme_rk800_data.WALL', () => {
	it('lands its hits in order, all within the first half of the build', () => {
		const sorted = [...WALL.hits].toSorted((first, second) => first - second)

		expect(WALL.hits).toStrictEqual(sorted)
		expect(Math.max(...WALL.hits)).toBeLessThan(WALL.build / HALF)
	})
})

describe('run_board_theme_rk800_data.CHOICES', () => {
	it('fits every choice label on the cursor plate', () => {
		const too_wide = CHOICES.filter(([, label]) => label.length > CURSOR.label_w)

		expect(too_wide).toStrictEqual([])
	})
})

describe('run_board_theme_rk800_data.ORDINALS', () => {
	it('names the ordinals other than TH, leaving the teens to TH', () => {
		expect(['1', '2', '3', '11', '12', '13', '22'].map((day) => ORDINALS.get(day))).toStrictEqual([
			'ST',
			'ND',
			'RD',
			undefined,
			undefined,
			undefined,
			'ND',
		])
	})

	it('names a month for every month of the year', () => {
		expect(new Set(MONTHS).size).toBe(MONTHS.length)
		expect(MONTHS.at(-1)).toBe('DEC')
	})
})
