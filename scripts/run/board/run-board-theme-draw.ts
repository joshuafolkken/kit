import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type {
	Box,
	Cell,
	CellTest,
	Channel,
	Grid,
	Point,
	ThemeApi,
	ThemeLayout,
	ThemeState,
} from './run-board-theme-host-types'

// What the themes drawn without a demo share (rk800, isac, ghost): one frame being drawn, the panel
// and the area as boxes, a write kept inside a box, and the small geometry their rings, links and
// screen-wide parts are laid out by.

const { code_points, is_rule, put, restyle } = run_board_theme_host_grid

// One frame being drawn: what the host handed the theme, the grid, the state and the tick.
interface ThemeDraw {
	api: ThemeApi
	grid: Grid
	s: ThemeState
	tick: number
}

const PAIR = 2
const TURN = Math.PI * PAIR
const BLANK: Cell = [' ', 'body']
// The rules' glint: its width in cells and the cells it runs a tick.
const GLINT = { w: 6, pace: 2 }

function clamped(share: number): number {
	return Math.min(1, Math.max(0, share))
}

// How far `value` is from `from` towards `from + span`, held to 0..1.
function share_of(value: number, from: number, span: number): number {
	return clamped((value - from) / span)
}

// How much of a typed place shows, 0 to 1; a place with no letters is typed through.
function typed_share(typed: Channel): number {
	return typed.total > 0 ? clamped(typed.length / typed.total) : 1
}

// The rows under the THROUGHPUT rule down to the area's last row.
function area_rows(layout: ThemeLayout): number {
	return layout.area_end - layout.area_top
}

// The panel right of THROUGHPUT and USAGE, under the rule.
function panel_box(layout: ThemeLayout): Box {
	return { x: layout.px, y: layout.area_top + 1, w: layout.pw, h: area_rows(layout) }
}

// THROUGHPUT and USAGE whole, under the rule.
function area_box(layout: ThemeLayout): Box {
	return { x: 0, y: layout.area_top + 1, w: layout.edge, h: area_rows(layout) }
}

// A box of the grid a part draws in.
interface Pane {
	grid: Grid
	box: Box
}

// `text` at `at`, counted from the pane's corner, cut at its right edge; a row or a column outside
// it is dropped, so a part never draws past the panel or under the area.
function put_in(pane: Pane, at: Point, text: string, style?: string): void {
	const { grid, box } = pane

	if (at.y < 0 || at.y >= box.h || at.x < 0) return
	const cut = code_points(text).slice(0, Math.max(0, box.w - at.x))

	put(grid, { y: box.y + at.y, x: box.x + at.x }, cut.join(''), style)
}

function panel_pane(draw: ThemeDraw): Pane {
	return { grid: draw.grid, box: panel_box(draw.api.layout) }
}

function area_pane(draw: ThemeDraw): Pane {
	return { grid: draw.grid, box: area_box(draw.api.layout) }
}

// THROUGHPUT and USAGE left of the panel, under the rule: the data an event may take.
function data_pane(draw: ThemeDraw): Pane {
	const { layout } = draw.api
	const box = { ...area_box(layout), w: Math.max(0, layout.px - 1) }

	return { grid: draw.grid, box }
}

// The whole screen, as an opening or an ending draws on it.
function screen_pane(draw: ThemeDraw): Pane {
	const { w, h } = draw.api.layout

	return { grid: draw.grid, box: { x: 0, y: 0, w, h } }
}

// A pane's cells blanked.
function clear_pane(pane: Pane): void {
	for (let y = 0; y < pane.box.h; y++) put_in(pane, { x: 0, y }, ' '.repeat(pane.box.w), 'body')
}

// Whether a mark may sit on row `y` beside a typed lane: another lane's row or the LANES rule, never
// a free seat row.
function is_lane_side(layout: ThemeLayout, y: number): boolean {
	return layout.lane_rows.includes(y) || y === layout.lanes_rule
}

// The point `turn` turns clockwise from the top of the ellipse round `center`.
function ring_point(center: Point, radius: Point, turn: number): Point {
	const angle = turn * TURN

	return {
		x: Math.round(center.x + Math.sin(angle) * radius.x),
		y: Math.round(center.y - Math.cos(angle) * radius.y),
	}
}

// How far `at` is from `center` in the ellipse's own radii: 1 on the ellipse.
function ring_reach(center: Point, radius: Point, at: Point): number {
	return Math.hypot((at.x - center.x) / radius.x, (at.y - center.y) / radius.y)
}

// The cells of the straight line from `from` to `to`, both ends included.
function line_points(from: Point, to: Point): Array<Point> {
	const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1)

	return Array.from({ length: steps + 1 }, (_, index) => ({
		x: Math.round(from.x + ((to.x - from.x) * index) / steps),
		y: Math.round(from.y + ((to.y - from.y) * index) / steps),
	}))
}

function blank_row_unless(row: Array<Cell>, y: number, is_kept: CellTest): void {
	for (const [x, cell] of row.entries()) {
		if (!is_kept(cell, x, y)) row[x] = BLANK
	}
}

// Every cell `is_kept` does not pick is blanked: the board shown only where a part has reached.
function blank_unless(grid: Grid, is_kept: CellTest): void {
	for (const [y, row] of grid.entries()) blank_row_unless(row, y, is_kept)
}

function is_drawn([ch]: Cell): boolean {
	return ch !== ' ' && ch !== ''
}

// The idle board's one quiet screen-wide effect: a short glint in `ink` runs along every rule, left
// to right, then waits as long as it ran; nothing while anything types.
function rule_glint(draw: ThemeDraw, ink: string): void {
	const { api, grid, s, tick } = draw

	if (s.busy) return
	const from = ((tick * GLINT.pace) % (api.layout.edge * PAIR)) - GLINT.w

	restyle(
		grid,
		(cell, x) => is_rule(cell) && x >= from && x < from + GLINT.w,
		() => ink,
	)
}

const run_board_theme_draw = {
	BLANK,
	PAIR,
	area_pane,
	clear_pane,
	data_pane,
	panel_pane,
	screen_pane,
	blank_unless,
	clamped,
	is_drawn,
	is_lane_side,
	line_points,
	panel_box,
	put_in,
	ring_point,
	ring_reach,
	rule_glint,
	share_of,
	typed_share,
}

export { run_board_theme_draw }
export type { Pane, ThemeDraw }
