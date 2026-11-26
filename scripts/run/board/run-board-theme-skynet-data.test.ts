import { describe, expect, it } from 'vitest'
import { run_board_theme_skynet_data } from './run-board-theme-skynet-data'

// joshuafolkken/kit#8917: the TERMINATOR theme's tables keep the demo's rows, columns and paths.

const { CURSOR_PATH, LISTING, theme_colors } = run_board_theme_skynet_data

describe('run_board_theme_skynet_data', () => {
	it('walks the response cursor down the list and back up', () => {
		expect(CURSOR_PATH).toStrictEqual([0, 1, 2, 3, 4, 3, 2, 1])
	})

	it('lays the listings on the demo rows and columns', () => {
		expect(LISTING.rows).toStrictEqual([7, 8, 9, 10, 11])
		expect(LISTING.area_rows).toStrictEqual([4, 5, 6, 7, 8, 9, 10, 11])
		expect(LISTING.threat_rows).toStrictEqual([5, 6, 7, 8, 9, 10, 11])
		expect(LISTING.head_rows).toStrictEqual([0, 1, 2])
		expect(LISTING.race_columns).toStrictEqual([40, 65, 90])
		expect(LISTING.side_columns).toStrictEqual([2, 86])
	})

	it('paints the body pale pink over red rules', () => {
		expect(theme_colors).toMatchObject({ body: '255;215;205', rule: '210;70;70' })
	})
})
