import { describe, expect, it } from 'vitest'
import { run_board_theme_isac_data } from './run-board-theme-isac-data'

// joshuafolkken/kit#9096: the isac theme's tables.

const { ALERT, FLARE, INKS, OPEN, RED_OF, RGB, STATUS, TX } = run_board_theme_isac_data
const { red_colors, theme_colors, theme_notes } = run_board_theme_isac_data
const NOTE_KEYS = ['a', 'i', 'n', 'p', 'r']
const RED_PAIRS = 4

describe('run_board_theme_isac_data.RED_OF', () => {
	it('turns each of the theme’s oranges into a distinct red tone', () => {
		expect(RED_OF).toHaveLength(RED_PAIRS)
		expect(RED_OF.map(([from]) => from)).toStrictEqual([RGB.orange, RGB.bright, RGB.dim, RGB.rule])
		expect(new Set(RED_OF.map(([, to]) => to)).size).toBe(RED_PAIRS)

		for (const [from, to] of RED_OF) expect(from).not.toBe(to)
	})

	it('reddens only roles the base colors carry', () => {
		for (const role of Object.keys(red_colors)) expect(theme_colors).toHaveProperty(role)

		expect(red_colors.body).toBe(RGB.red)
	})
})

describe('run_board_theme_isac_data.INKS', () => {
	it('lights the banner white on red and flashes red on white', () => {
		expect(INKS.WARNING).toContain(`48;2;${RGB.red}`)
		expect(INKS.FLASH).toContain(`48;2;${RGB.white}`)
		expect(INKS.ORANGE).toContain(RGB.orange)
	})
})

describe('run_board_theme_isac_data timings', () => {
	it('keeps every part inside its length', () => {
		expect(OPEN.fade_from + OPEN.fade_ticks).toBeLessThanOrEqual(OPEN.ticks)
		expect(FLARE.gone).toBeLessThanOrEqual(FLARE.ticks)
		expect(FLARE.close_from + FLARE.close_ticks).toBeLessThanOrEqual(FLARE.gone)
		expect(ALERT.drain_from + ALERT.drain_ticks).toBeLessThanOrEqual(ALERT.play)
	})

	it('lights no more armor segments than it has, and blinks lit for part of a cycle', () => {
		expect(STATUS.armor_lit).toBeLessThanOrEqual(STATUS.armor_cells)
		expect(TX.blink_lit).toBeLessThan(TX.blink)
		expect(STATUS.blink_lit).toBeLessThan(STATUS.blink)
	})
})

describe('run_board_theme_isac_data.theme_notes', () => {
	it('describes every demo event', () => {
		expect(Object.keys(theme_notes)).toHaveLength(NOTE_KEYS.length)

		for (const key of NOTE_KEYS) expect(theme_notes).toHaveProperty(key)
	})
})
