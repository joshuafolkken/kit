import { describe, expect, it } from 'vitest'
import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import type { DemoKey } from './run-board-theme-host-sample'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, Grid } from './run-board-theme-host-types'

// joshuafolkken/kit#9096: what the themes drawn without a demo share — the panel, area and screen as
// panes, a write kept inside its pane, the rings' and links' geometry and the rules' idle glint —
// drawn on the demo's board or on a small grid of its own.

const {
	BLANK,
	PAIR,
	area_pane,
	blank_unless,
	clamped,
	clear_pane,
	data_pane,
	is_drawn,
	is_lane_side,
	line_points,
	panel_box,
	panel_pane,
	put_in,
	ring_point,
	ring_reach,
	rule_glint,
	screen_pane,
	share_of,
	typed_share,
} = run_board_theme_draw
const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state
const { layout } = HOST

const HALF = 0.5
const QUARTER = 0.25
const SPAN = 10
const SMALL = { w: 6, h: 3 }
const CENTER = { x: 10, y: 10 }
const RADIUS = { x: 4, y: 2 }
const GLINT_W = 6
// At this tick the glint starts at the left edge: two cells a tick, less its width.
const GLINT_TICK = GLINT_W / PAIR
const BUSY_TICK = 85
const INK = 'glint-test'

// A small grid of `ch`, every cell in `body`.
function small_grid(ch: string): Grid {
	return Array.from({ length: SMALL.h }, () =>
		Array.from({ length: SMALL.w }, (): Cell => [ch, 'body']),
	)
}

function row_text(grid: Grid, y: number): string {
	return (grid[y] ?? []).map(([ch]) => ch).join('')
}

// The demo's `event` at `tick`, drawn onto a copy of its board.
function draw_at(event: DemoKey, tick: number): ThemeDraw {
	const grid = HOST.api.board.map((row) => row.map(([ch, style]): Cell => [ch, style]))

	return { api: HOST.api, grid, s: state_of(layout, HOST.events[event], tick), tick }
}

// Each cell's place the glint's ink took.
function inked(grid: Grid): Array<number> {
	return grid.flatMap((row) => [...row.keys()].filter((x) => row[x]?.[1] === INK))
}

describe('run_board_theme_draw shares', () => {
	it('holds a share to 0..1', () => {
		expect([clamped(-1), clamped(HALF), clamped(PAIR)]).toStrictEqual([0, HALF, 1])
	})

	it('reads how far a value is along its span', () => {
		expect(share_of(SPAN / PAIR, 0, SPAN)).toBe(HALF)
		expect(share_of(-SPAN, 0, SPAN)).toBe(0)
		expect(share_of(SPAN * PAIR, 0, SPAN)).toBe(1)
	})

	it('reads a typed place’s share, one with no letters typed through', () => {
		const { row } = draw_at('i', 0).s

		expect(typed_share({ ...row, length: 1, total: PAIR })).toBe(HALF)
		expect(typed_share({ ...row, length: 0, total: 0 })).toBe(1)
	})
})

describe('run_board_theme_draw panes', () => {
	const rows = layout.area_end - layout.area_top

	it('boxes the panel under the rule', () => {
		const panel = { x: layout.px, y: layout.area_top + 1, w: layout.pw, h: rows }

		expect(panel_box(layout)).toStrictEqual(panel)
		expect(panel_pane(draw_at('i', 0)).box).toStrictEqual(panel)
	})

	it('boxes the area whole, its data left of the panel, and the screen', () => {
		const draw = draw_at('i', 0)
		const area = { x: 0, y: layout.area_top + 1, w: layout.edge, h: rows }

		expect(area_pane(draw).box).toStrictEqual(area)
		expect(data_pane(draw).box).toStrictEqual({ ...area, w: layout.px - 1 })
		expect(screen_pane(draw).box).toStrictEqual({ x: 0, y: 0, w: layout.w, h: layout.h })
	})
})

describe('run_board_theme_draw writes in a pane', () => {
	it('writes inside a pane, cut at its right edge', () => {
		const grid = small_grid(' ')
		const pane: Pane = { grid, box: { x: 1, y: 1, w: 3, h: 1 } }

		put_in(pane, { x: 1, y: 0 }, 'abcd', 'hi')

		expect(row_text(grid, 1)).toBe('  ab  ')
		expect(grid[1]?.[PAIR]).toStrictEqual(['a', 'hi'])
	})

	it('drops a write on a row or a column outside the pane', () => {
		const grid = small_grid(' ')
		const pane: Pane = { grid, box: { x: 1, y: 1, w: 3, h: 1 } }

		put_in(pane, { x: 0, y: -1 }, 'a')
		put_in(pane, { x: 0, y: 1 }, 'b')
		put_in(pane, { x: -1, y: 0 }, 'c')

		expect(grid).toStrictEqual(small_grid(' '))
	})

	it('blanks a pane’s cells and no others', () => {
		const grid = small_grid('x')

		clear_pane({ grid, box: { x: 1, y: 1, w: PAIR, h: 1 } })

		expect([0, 1, PAIR].map((y) => row_text(grid, y))).toStrictEqual(['xxxxxx', 'x  xxx', 'xxxxxx'])
	})
})

describe('run_board_theme_draw geometry', () => {
	it('turns a ring point clockwise from the top', () => {
		const points = [0, QUARTER, HALF].map((turn) => ring_point(CENTER, RADIUS, turn))

		expect(points).toStrictEqual([
			{ x: CENTER.x, y: CENTER.y - RADIUS.y },
			{ x: CENTER.x + RADIUS.x, y: CENTER.y },
			{ x: CENTER.x, y: CENTER.y + RADIUS.y },
		])
	})

	it('reaches 1 on the ring and 0 at its center', () => {
		expect(ring_reach(CENTER, RADIUS, { x: CENTER.x + RADIUS.x, y: CENTER.y })).toBe(1)
		expect(ring_reach(CENTER, RADIUS, CENTER)).toBe(0)
	})

	it('lays a line’s cells, both ends included', () => {
		expect(line_points({ x: 0, y: 0 }, { x: 3, y: 1 })).toStrictEqual([
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 1 },
			{ x: 3, y: 1 },
		])
		expect(line_points(CENTER, CENTER)).toStrictEqual([CENTER, CENTER])
	})

	it('seats a mark beside a lane row or the LANES rule only', () => {
		const lanes = { ...layout, lane_rows: [PAIR, 3], lanes_rule: 1 }

		expect([0, 1, PAIR, 3, 4].map((y) => is_lane_side(lanes, y))).toStrictEqual([
			false,
			true,
			true,
			true,
			false,
		])
	})
})

describe('run_board_theme_draw cells', () => {
	it('tells a drawn cell from a blank one', () => {
		expect([is_drawn(['a', 'body']), is_drawn(BLANK), is_drawn(['', 'body'])]).toStrictEqual([
			true,
			false,
			false,
		])
	})

	it('blanks every cell it is not told to keep', () => {
		const grid = small_grid('x')

		blank_unless(grid, (_, x) => x === 0)

		expect(grid.every((row) => row[0]?.[0] === 'x')).toBe(true)
		expect(grid.every((row) => row.slice(1).every((cell) => cell === BLANK))).toBe(true)
	})

	it('runs the idle glint along the rules, its width from where it has reached', () => {
		const draw = draw_at('i', GLINT_TICK)

		expect(draw.s.busy).toBe(false)
		rule_glint(draw, INK)
		const places = inked(draw.grid)

		expect(places.length).toBeGreaterThan(0)
		expect(places.every((x) => x >= 0 && x < GLINT_W)).toBe(true)
	})

	it('runs no glint while anything types', () => {
		const draw = draw_at('n', BUSY_TICK)

		expect(draw.s.busy).toBe(true)
		rule_glint(draw, INK)

		expect(inked(draw.grid)).toStrictEqual([])
	})
})
