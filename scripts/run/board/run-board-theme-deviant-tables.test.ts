import { describe, expect, it } from 'vitest'
import { run_board_theme_deviant_tables } from './run-board-theme-deviant-tables'

// joshuafolkken/kit#9096: the deviant theme's later tables — the order their timings depend on.

const { CARD_AT, LED, NOTE, RESULTS } = run_board_theme_deviant_tables
const NUMBER_COUNT = Object.keys(RESULTS.captions).length

describe('run_board_theme_deviant_tables.RESULTS', () => {
	it('closes the light bars before the title fades in', () => {
		expect(RESULTS.bars_from + RESULTS.bars_spread).toBeLessThanOrEqual(RESULTS.title_from)
	})

	it('shows every number before the bars go dark', () => {
		const last_shown = RESULTS.first_from + RESULTS.step * (NUMBER_COUNT - 1) + RESULTS.fade

		expect(last_shown).toBeLessThanOrEqual(RESULTS.shut_from)
	})

	it('types the status line after the title', () => {
		expect(RESULTS.status_from).toBeGreaterThan(RESULTS.title_from)
	})
})

describe('run_board_theme_deviant_tables.CARD_AT', () => {
	it('stands the clue cards in order along the timeline', () => {
		const shares = [CARD_AT.first, CARD_AT.second, CARD_AT.third]

		expect(shares).toStrictEqual(shares.toSorted((first, second) => first - second))
		expect(shares.every((share) => share > 0 && share < 1)).toBe(true)
	})
})

describe('run_board_theme_deviant_tables.LED', () => {
	it('takes the idle LED further to the night than the info one', () => {
		expect(LED.idle).toBeGreaterThan(LED.info)
	})
})

describe('run_board_theme_deviant_tables.NOTE', () => {
	it('starts the falling notice inside its own run', () => {
		expect(NOTE.fall_lead).toBeLessThan(NOTE.fade + NOTE.hold + NOTE.fade)
	})
})
