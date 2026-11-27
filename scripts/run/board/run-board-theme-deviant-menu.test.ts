import { describe, expect, it } from 'vitest'
import { run_board_theme_deviant_fixture } from './run-board-theme-deviant-fixture'
import { run_board_theme_deviant_menu } from './run-board-theme-deviant-menu'
import { run_board_theme_deviant_parts } from './run-board-theme-deviant-parts'

// joshuafolkken/kit#9096: the deviant theme's menus — their entrance, the idle panel's pages and
// the CHAPTERS page's plates.

const {
	TILE,
	chapters_of,
	chapters_page,
	cursor_at,
	entrance,
	entrance_ticks,
	has_entered,
	lane_labels,
	lanes_of,
	page_of,
	plate_share,
} = run_board_theme_deviant_menu
const { stage_of } = run_board_theme_deviant_parts
const { HOST, draw_at, panel_text } = run_board_theme_deviant_fixture
const PAGE_TICKS = 300
const HOLD = 70
const FOUR = 4

describe('run_board_theme_deviant_menu.entrance', () => {
	it('shows each item’s bar in turn, then its label, then the cursor', () => {
		expect(entrance(0, 1, FOUR)).toStrictEqual({ bar: 0, label: 0, cursor: 0 })
		expect(entrance(2, 1, FOUR).bar).toBe(1)
		expect(entrance(entrance_ticks(FOUR) + FOUR, 0, FOUR)).toStrictEqual({
			bar: 0,
			label: 1,
			cursor: 1,
		})
	})

	it('takes two ticks an item, a pause and two fades', () => {
		expect(entrance_ticks(FOUR)).toBe(18)
	})
})

describe('run_board_theme_deviant_menu.has_entered', () => {
	it('has entered once its bar or its label shows', () => {
		expect(has_entered({ bar: 0, label: 0, cursor: 0 })).toBe(false)
		expect(has_entered({ bar: 0, label: 0.5, cursor: 0 })).toBe(true)
	})
})

describe('run_board_theme_deviant_menu.plate_share', () => {
	it('fades in on the cursor’s item and out on the one it left', () => {
		expect(plate_share(1, HOLD + 5, FOUR)).toBe(0.5)
		expect(plate_share(0, HOLD + 5, FOUR)).toBe(0.5)
		expect(plate_share(2, HOLD + 5, FOUR)).toBeUndefined()
	})

	it('keeps one item alone lit', () => {
		expect(plate_share(0, HOLD * 3, 1)).toBe(1)
	})
})

describe('run_board_theme_deviant_menu.page_of', () => {
	it('turns from the choices to the chapters to the status', () => {
		expect(
			[0, PAGE_TICKS + 5, PAGE_TICKS * 2, PAGE_TICKS * 3].map((tick) => page_of(tick)),
		).toStrictEqual([
			{ name: 'choices', age: 0 },
			{ name: 'chapters', age: 5 },
			{ name: 'status', age: 0 },
			{ name: 'choices', age: 0 },
		])
	})
})

describe('run_board_theme_deviant_menu.cursor_at', () => {
	it('moves the cursor an item every hold', () => {
		expect(cursor_at(HOLD * FOUR + 3, FOUR)).toStrictEqual({ index: 0, moved: 3 })
		expect(cursor_at(HOLD + 1, FOUR)).toStrictEqual({ index: 1, moved: 1 })
	})
})

describe('run_board_theme_deviant_menu.lanes_of', () => {
	it('labels the lanes the board runs by their issue numbers', () => {
		expect(lanes_of(HOST.api).map(({ y }) => y)).toStrictEqual(HOST.layout.lane_rows)
		expect(lane_labels(HOST.api)).toStrictEqual(['#8899', '#8897', '#8826'])
	})
})

describe('run_board_theme_deviant_menu.chapters_of', () => {
	it('steps the plates a row down and past the one before', () => {
		const draw = draw_at('i', 0)
		const chapters = chapters_of(draw, stage_of(draw))

		expect(chapters.map(({ label, x, y }) => [label, x, y])).toStrictEqual([
			['#8899', 1, 3],
			['#8897', 12, 4],
			['#8826', 23, 5],
		])
	})

	it('leaves out a plate that would reach the triangle', () => {
		const draw = draw_at('i', 0)
		const stage = stage_of(draw)
		const narrow = { ...stage, right: stage.right - FOUR }

		expect(chapters_of(draw, narrow).map(({ label }) => label)).toStrictEqual(['#8899', '#8897'])
	})
})

describe('run_board_theme_deviant_menu.chapters_page', () => {
	it('titles the page and lays a tile over each plate once entered', () => {
		const draw = draw_at('i', 0)

		chapters_page(draw, stage_of(draw), HOLD)

		expect(panel_text(draw.grid, 1)).toContain('C H A P T E R S')
		expect(panel_text(draw.grid, 2)).toContain(TILE)
		expect(panel_text(draw.grid, 3)).toContain('#8899')
	})
})
