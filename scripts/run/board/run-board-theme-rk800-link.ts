import { run_board_theme_draw, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Cell, Grid, Point, ThemeLayout } from './run-board-theme-host-types'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_menu, type Page } from './run-board-theme-rk800-menu'
import { run_board_theme_rk800_parts, type Stage } from './run-board-theme-rk800-parts'
import { run_board_theme_rk800_rules } from './run-board-theme-rk800-rules'

// The rk800 theme's idle link line: a thin right-angle line in dim steel blue from the panel's
// selected plate out of its left edge — on the CHAPTERS page to the lane the plate stands for, down
// the panel's side, along the blank row under the area and down the board's left margin; on the
// choice list to the rule nearest the cursor. It is drawn through blank cells only, a rule's own
// cell recolored and never redrawn, and stops short of the first text in its way. A small bright
// blue dot travels it from the plate, once each time the selection moves.

const { is_rule } = run_board_theme_host_grid
const { PAIR, line_points } = run_board_theme_draw
const { CHOICES, RGB, SCAN } = run_board_theme_rk800_data
const { chapters_of, cursor_at, entrance_ticks, lanes_of, page_of } = run_board_theme_rk800_menu
const { bold, ink, mix, stage_of } = run_board_theme_rk800_parts
const { is_rule_row } = run_board_theme_rk800_rules

// The line's dimness and the ticks the dot takes.
const LINK = { dim: 0.35, travel: 20 }
// The ticks into the scan band's cycle the other idle effects start on: a dot that would start with
// one of them starts a tick later.
const OTHERS = { reticle: 0, glints: 15, glitch: 45, reticle_again: 60, glints_again: 80 }
const STARTS: ReadonlySet<number> = new Set(Object.values(OTHERS))
const WIRE = ink(mix(RGB.steel, RGB.night, LINK.dim))
const DOT = bold(RGB.blue)

// A cell of the line and the line's character on it.
interface Step {
	at: Point
	ch: string
}

// A line's cells from the plate on, and the ticks since the selection moved to it.
interface Route {
	steps: Array<Step>
	moved: number
}

// The cells strictly between two corners, all one character.
function run(from: Point, to: Point, ch: string): Array<Step> {
	return line_points(from, to)
		.slice(1, -1)
		.map((at) => ({ at, ch }))
}

// From beside a plate to lane row `to_y`: out of the panel's left edge, down its side, along the row
// under the area, down the left margin, and a cell toward the lane.
function lane_path(layout: ThemeLayout, from: Point, to_y: number): Array<Step> {
	const side = { y: from.y, x: layout.px - 1 }
	const turn = { y: layout.area_end + 1, x: side.x }
	const margin = { y: turn.y, x: 0 }
	const lane = { y: to_y, x: 0 }

	return [
		{ at: from, ch: '─' },
		...run(from, side, '─'),
		{ at: side, ch: '┌' },
		...run(side, turn, '│'),
		{ at: turn, ch: '┘' },
		...run(turn, margin, '─'),
		{ at: margin, ch: '┌' },
		...run(margin, lane, '│'),
		{ at: lane, ch: '└' },
		{ at: { y: to_y, x: 1 }, ch: '─' },
	]
}

// The rule nearest row `y` among the area's own, under its top rule.
function near_rule(draw: ThemeDraw, y: number): number | undefined {
	const { area_top, area_end } = draw.api.layout
	const rows = Array.from({ length: area_end - area_top }, (_, index) => area_top + 1 + index)
	const rules = rows.filter((row) => is_rule_row(draw.grid, row))

	return rules.toSorted((first, second) => Math.abs(first - y) - Math.abs(second - y)).at(0)
}

// From the cursor's row at the panel's left edge to the end of the rule on row `to_y`.
function rule_path(layout: ThemeLayout, from_y: number, to_y: number): Array<Step> {
	const side = { y: from_y, x: layout.px - 1 }
	const turn = { y: to_y, x: side.x }
	const corners = to_y > from_y ? '┌┘' : '└┐'
	const first = { at: { y: from_y, x: layout.px }, ch: '─' }
	const last = { at: { y: to_y, x: side.x - 1 }, ch: '─' }

	if (to_y === from_y) return [first, { at: side, ch: '─' }, last]

	return [
		first,
		{ at: side, ch: corners.charAt(0) },
		...run(side, turn, '│'),
		{ at: turn, ch: corners.charAt(1) },
		last,
	]
}

// The CHAPTERS page's line: from the selected plate to its lane; none for the board's own plate.
function chapter_route(draw: ThemeDraw, stage: Stage, age: number): Route | undefined {
	const chapters = chapters_of(draw, stage)
	const since = age - entrance_ticks(chapters.length)
	const { index, moved } = cursor_at(since, chapters.length)
	const [chapter, lane] = [chapters[index], lanes_of(draw.api)[index]]

	if (!chapter || !lane || since < 0) return undefined
	// The line leaves two cells left of the plate, clear of the line that joins it to the plate before.
	const { x, y } = stage.pane.box
	const from = { y: y + chapter.y, x: x + Math.max(0, chapter.x - PAIR) }

	return { steps: lane_path(draw.api.layout, from, lane.y), moved }
}

// The choice list's line: from the cursor's line to the rule nearest it.
function choice_route(draw: ThemeDraw, stage: Stage, age: number): Route | undefined {
	const since = age - entrance_ticks(CHOICES.length)
	const { index, moved } = cursor_at(since, CHOICES.length)
	const from_y = stage.pane.box.y + stage.body + index
	const to_y = near_rule(draw, from_y)

	if (to_y === undefined || since < 0) return undefined

	return { steps: rule_path(draw.api.layout, from_y, to_y), moved }
}

// A cell of the line: its character on a blank cell, a rule's own cell recolored; none on text.
function wired(cell: Cell | undefined, look: Step, style: string): Cell | undefined {
	if (cell === undefined) return undefined
	if (cell[0] === ' ') return [look.ch, style]

	return is_rule(cell) ? [cell[0], style] : undefined
}

// One cell of the line laid; false where text stands in its way.
function lay_step(grid: Grid, step: Step, style: string): boolean {
	const row = grid[step.at.y]
	const cell = wired(row?.[step.at.x], step, style)

	if (row === undefined || cell === undefined) return false
	row[step.at.x] = cell

	return true
}

// The step the dot is on; none once it has arrived.
function dot_at(tick: number, route: Route): number {
	const lag = STARTS.has((tick - route.moved) % SCAN.every) ? 1 : 0

	return Math.floor(((route.moved - lag) / LINK.travel) * route.steps.length)
}

// The line laid as far as it can go, the dot on it.
function lay(draw: ThemeDraw, route: Route): void {
	const dot = dot_at(draw.tick, route)
	const looks = route.steps.map((step, index) =>
		index === dot ? { step: { ...step, ch: '•' }, style: DOT } : { step, style: WIRE },
	)

	for (const look of looks) {
		if (!lay_step(draw.grid, look.step, look.style)) return
	}
}

// The line each page draws; the status page draws none.
const ROUTES: Partial<Record<Page['name'], typeof choice_route>> = {
	chapters: chapter_route,
	choices: choice_route,
}

function link(draw: ThemeDraw): void {
	const stage = stage_of(draw)
	const page = page_of(draw.tick)
	const route = ROUTES[page.name]?.(draw, stage, page.age)

	if (route !== undefined) lay(draw, route)
}

const run_board_theme_rk800_link = { lane_path, link, rule_path }

export { run_board_theme_rk800_link }
