import { describe, expect, it } from 'vitest'
import { run_board_theme_skynet_data } from './run-board-theme-skynet-data'
import { run_board_theme_skynet_fixture } from './run-board-theme-skynet-fixture'
import { run_board_theme_skynet_listing } from './run-board-theme-skynet-listing'

// joshuafolkken/kit#8917: the TERMINATOR theme's assembly listing, its SCAN lines and its races.

const { hex, listing_column, listing_line, race_columns, ticker_text } =
	run_board_theme_skynet_listing
const { INKS } = run_board_theme_skynet_data
const { fresh_grid, row_text } = run_board_theme_skynet_fixture
const CODE_LINE = /^[\dA-F]{4} {3}[A-Z]{3} (?:#\$[\dA-F]{2}|\$[\dA-F]{4})$/u

describe('run_board_theme_skynet_listing', () => {
	it('writes hex in capitals, padded to the width', () => {
		expect(hex(47, 4)).toBe('002F')
	})

	it('makes every ninth line a SCAN line with a match', () => {
		expect(listing_line(18)).toMatch(/^SCAN [\dA-F]{4} {2}MATCH \d{2}\.\d%$/u)
	})

	it('makes the other lines an address, a mnemonic and an operand', () => {
		expect(listing_line(1)).toMatch(CODE_LINE)
		expect(listing_line(1, 11)).toMatch(CODE_LINE)
	})

	it('runs eight lines along the ticker, single spaced', () => {
		const text = ticker_text(1)

		expect(text.split(' · ')).toHaveLength(8)
		expect(text).not.toMatch(/ {2}/u)
	})
})

describe('run_board_theme_skynet_listing columns', () => {
	it('lights the newest line of a racing column', () => {
		const grid = fresh_grid()

		listing_column(grid, { x: 2, width: 23, rows: [4, 5], from: 1, salt: 5, is_racing: true })

		expect(grid[5]?.[2]?.[1]).toBe(INKS.INK)
		expect(grid[4]?.[2]?.[1]).toBe(INKS.PINK)
		expect(row_text(grid, 4).slice(2, 25)).toBe(listing_line(1).padEnd(23).slice(0, 23))
	})

	it('starts each raced column further on, salted apart', () => {
		const grid = fresh_grid()

		race_columns(grid, {
			columns: [2, 40],
			width: 20,
			rows: [4],
			step: 10,
			offset: 1,
			salt: 3,
			salt_step: 5,
			is_racing: false,
		})

		expect(row_text(grid, 4).slice(40, 60)).toBe(listing_line(21, 8).padEnd(20).slice(0, 20))
	})
})
