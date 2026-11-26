import { describe, expect, it } from 'vitest'
import { run_board_theme_host_api } from './run-board-theme-host-api'
import type { ThemeLayout } from './run-board-theme-host-types'
import { run_board_theme_layer_fixture } from './run-board-theme-layer-fixture'
import { run_board_theme_layout, type LayoutView } from './run-board-theme-layout'
import { run_board_theme_roles } from './run-board-theme-roles'
import type { KeyedLine } from './run-board-type-rows'

const { SIZE, VIEW, base_canvas } = run_board_theme_layer_fixture
const { MIN_PANEL_ROWS, MIN_PANEL_WIDTH, edit_board, layout_of } = run_board_theme_layout
const NARROW = { rows: 8, columns: 40 }

function board_of(size = SIZE): ReturnType<typeof run_board_theme_roles.grid_of> {
	return run_board_theme_roles.grid_of(base_canvas(size))
}

function lane(issue: number, row: number): KeyedLine {
	return { key: `lanes:${String(issue)}`, index: row - 1, row, text: '  x', prefix_columns: 5 }
}

function with_lanes(...lanes: Array<KeyedLine>): LayoutView {
	return {
		...VIEW,
		keyed: [...VIEW.keyed.filter(({ key }) => !key.startsWith('lanes:')), ...lanes],
	}
}

describe('run_board_theme_layout.layout_of', () => {
	it('takes the panel and area from the lamps kit laid out', () => {
		const layout = layout_of(VIEW, board_of(), SIZE)

		expect(layout).toMatchObject({ area_top: 4, area_end: 11, px: 43, edge: 99, w: 100, h: 17 })
		expect(layout?.level_spot).toEqual({ y: 4, x: 81, w: 18 })
	})

	// The notice and the now line run to two columns short of the pins, the rules' last 13 columns,
	// whatever their words' length (the confirmed specification §2).
	it('takes the header spans from the keyed notice and now line', () => {
		const layout = layout_of(VIEW, board_of(), SIZE)

		expect(layout).toMatchObject({
			pins_x: 86,
			notice: { y: 1, x: 32, end: 84 },
			progress: { y: 2, x: 32, end: 84 },
			head_colons: [{ y: 0, x: 17 }],
			sign_x: 14,
		})
	})
})

describe('run_board_theme_layout.layout_of lanes', () => {
	const two_lanes = with_lanes(lane(8899, 15), lane(8900, 16))

	it('places a ROW on the last lane', () => {
		const layout = layout_of(two_lanes, board_of(), SIZE)

		expect(layout?.lane_rows).toEqual([14, 15])
		expect(layout?.row.y).toBe(15)
	})

	it('places a ROW on the lane its key names, its issue where the row draws it', () => {
		const layout = layout_of({ ...two_lanes, row_key: 'lanes:8899' }, board_of(), SIZE)

		expect(layout?.row.y).toBe(14)
		expect(layout?.issue_x).toBe(9)
		expect(layout?.new_lane).toBe('8899')
	})

	it('leaves an empty seat out of the lanes', () => {
		const seat: KeyedLine = { ...lane(1, 16), key: 'seat:waiting' }
		const view = with_lanes(lane(8899, 15), seat)

		expect(layout_of(view, board_of(), SIZE)?.lane_rows).toEqual([14])
	})

	it('gives a ROW an empty span with no lane', () => {
		const layout = layout_of(with_lanes(), board_of(), SIZE)

		expect(layout?.lane_rows).toEqual([])
		expect(layout?.row).toEqual({ y: 12, x: 0, end: 0 })
	})

	it('keeps every place within a narrow terminal', () => {
		const narrow = { ...SIZE, columns: 90 }
		const layout = layout_of(VIEW, board_of(), narrow)

		expect(layout?.edge).toBe(narrow.columns)
		expect(layout?.pins_x).toBeLessThanOrEqual(narrow.columns)
		expect(layout?.notice.end).toBeLessThanOrEqual(narrow.columns)
	})
})

// joshuafolkken/kit#8917: a pane cut left of the panel leaves the theme no column to draw in.
// joshuafolkken/kit#8917 (the confirmed specification §2): a folded section or a small pane keeps the
// theme's looks; only the area's drawings fall off the frame — the area laid out past the last row.
function is_area_off_frame(layout: ThemeLayout | undefined, rows: number): boolean {
	return layout !== undefined && layout.area_top >= rows
}

describe('run_board_theme_layout.layout_of cut off', () => {
	it('lays the area off the frame where the pane cuts the panel off, the theme kept', () => {
		const layout = layout_of(VIEW, board_of(NARROW), NARROW)

		expect(is_area_off_frame(layout, NARROW.rows)).toBe(true)
		expect(layout?.w).toBe(NARROW.columns)
	})

	it('lays the area off the frame without a lamp on screen, the level on the first rule', () => {
		const layout = layout_of({ ...VIEW, lamps: [] }, board_of(), SIZE)

		expect(is_area_off_frame(layout, SIZE.rows)).toBe(true)
		expect(layout?.level_spot.y).toBe(4)
	})

	it('lays out a panel of six rows, the area off the frame on a shorter one', () => {
		const six = VIEW.lamps.filter(({ panel_row }) => panel_row < MIN_PANEL_ROWS)
		const lamps = VIEW.lamps.filter(({ panel_row }) => panel_row < MIN_PANEL_ROWS - 1)
		const shorter = layout_of({ ...VIEW, lamps }, board_of(), SIZE)

		expect(layout_of({ ...VIEW, lamps: six }, board_of(), SIZE)?.area_end).toBe(10)
		expect(is_area_off_frame(shorter, SIZE.rows)).toBe(true)
		expect(shorter?.level_spot.y).toBe(4)
	})

	it('lays out a panel exactly forty columns wide, the area off the frame on a narrower one', () => {
		const exact = { ...SIZE, columns: 43 + MIN_PANEL_WIDTH }
		const narrower = { ...exact, columns: exact.columns - 1 }

		const cut = layout_of(VIEW, board_of(), narrower)

		expect(layout_of(VIEW, board_of(), exact)?.pw).toBe(MIN_PANEL_WIDTH)
		expect(is_area_off_frame(cut, SIZE.rows)).toBe(true)
	})
})

describe('run_board_theme_layout.edit_board', () => {
	it('blanks the panel and runs the rule through the level spot', () => {
		const board = board_of()
		const layout = layout_of(VIEW, board, SIZE)

		if (layout === undefined) throw new Error('no layout')
		edit_board(board, layout)
		const { plain_of } = run_board_theme_host_api

		function plain(y: number): string {
			return plain_of(board, y)
		}

		expect(plain(4)).not.toContain('TRACE')
		expect(plain(4).trimEnd().endsWith('-')).toBe(true)
		expect(
			plain(5)
				.slice(layout.px - 1)
				.trim(),
		).toBe('')
	})
})
