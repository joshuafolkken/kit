import type { Cell, Point, ThemeApi, ThemeLayout } from './run-board-theme-host-types'
import { run_board_theme_rules } from './run-board-theme-rules'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'
import { run_board_theme_wopr_phase } from './run-board-theme-wopr-phase'
import { run_board_theme_wopr_wars, type Sky, type War } from './run-board-theme-wopr-wars'

// The WARGAMES theme's places on the board (joshuafolkken/kit#8917), ported from the confirmed theme
// demo: every table it builds from the host's layout, once a theme.

const { CLOSING, THE_CODE } = run_board_theme_wopr_data
const { mixed } = run_board_theme_wopr_phase
const { land_cells_of, table_at, wars_of } = run_board_theme_wopr_wars

// A section rule's dash: its cell and the step it scatters back on.
interface RuleCell extends Point {
	back: number
}

interface Lamps {
	x: number
	count: number
	top: number
}

interface Sweep {
	y: number
	left: number
	cells: number
}

interface Wopr extends Sky {
	api: ThemeApi
	lamps: Lamps
	mark_x: number
	sweep: Sweep
	rule_cells: Array<RuleCell>
	coast_cells: Array<Point>
	screen: { x0: number; x1: number }
	window_w: number
	positions: Array<number>
	led_y: number
	board_x: number
	tally_x: number
	wars: Array<War>
	table_at: Array<number>
	table: { rows: number; x: number; w: number }
	closing: Point
	strip_x: number
}

// A lamp every other column, on seven rows; a row shorter than eight lamps has none.
const LAMP = { every: 2, fewest: 8 }
// Twenty cells on the empty line under the header, its right end five cells past the third line's `″`.
const SWEEP = { y: 3, mark_row: 2, reach: 5, span: 19, cells: 20 }
// The header's clocks end three columns short of its machine column, an icon and a blank before it.
const CLOCK_END = 3
const SCATTER_STEPS = 20
// The tic-tac-toe screen runs from 26 to 2 columns left of DEFCON; the WINNER tally 3 past it.
const SCREEN = { left: 26, right: 2, tally: 3 }
// Ten LED characters five columns wide, one between characters, three between groups of 3, 4, 3.
const LED_W = 5
const STRIDE = LED_W + 1
const GROUP_GAP = 3
const GROUPS = '343'
// The tic-tac-toe board: three cells seven columns wide, a line column between them.
const CELL_W = 7
const CELLS_ACROSS = 3
const BOARD_W = CELLS_ACROSS * (CELL_W + 1) - 1
const HALF = 2
// The table starts two columns into the right half and ends two short of the edge.
const TABLE_MARGIN = 2
// The PROGRESS strip sits six columns left of DEFCON.
const STRIP_LEFT = 6

function lamps_of(api: ThemeApi): Lamps {
	const { px, area_top, edge } = api.layout
	const x = px + 1
	const per_row = Math.floor((edge - x + 1) / LAMP.every)

	return { x, count: per_row < LAMP.fewest ? 0 : per_row, top: area_top + 1 }
}

// The header's last `″` left of its machine column: the third line's in the demo, any line's on a live
// board, whose third line draws no seconds while the run is stopped; the clocks' end without one.
function mark_x_of(api: ThemeApi): number {
	const marks = Array.from({ length: SWEEP.mark_row + 1 }, (_, y) =>
		api
			.plain(y)
			.slice(0, api.layout.head_left.w + 1)
			.indexOf('″'),
	)
	const mark = Math.max(...marks)

	return mark < 0 ? api.layout.column_x - CLOCK_END : mark
}

// Every section rule's `─` past its lead (`-- `, label-pair.ts:23) — drawn `-` in the dash paint —
// but DEFCON's end of the throughput rule.
function is_defcon_tail(layout: ThemeLayout, at: Point): boolean {
	return at.y === layout.level_spot.y && at.x >= layout.level_spot.x - 1
}

// A rule's line cell past its lead — the demo's `--`, a live rule's fold marker `V` / `>` — the cells up
// to the row's first blank.
function is_rule_dash(layout: ThemeLayout, cell: Cell, at: Point & { lead: number }): boolean {
	const is_dash = at.x > at.lead && run_board_theme_rules.is_rule_line(cell)

	return is_dash && !is_defcon_tail(layout, at)
}

function rule_row_cells(api: ThemeApi, cells: Array<Cell>, y: number): Array<RuleCell> {
	const lead = cells.findIndex(([ch]) => ch === ' ')

	return cells
		.map((cell, x) => ({ cell, x }))
		.filter(({ cell, x }) => is_rule_dash(api.layout, cell, { y, x, lead }))
		.map(({ x }) => ({ y, x, back: mixed([y + 1, x + 1]) % SCATTER_STEPS }))
}

// Every section rule's line cells, the rules found by their cells' role (joshuafolkken/kit#8917).
function rule_cells_of(api: ThemeApi): Array<RuleCell> {
	const { h } = api.layout
	const rows = run_board_theme_rules.rule_rows_of(api.board).filter((y) => y < h)

	return rows.flatMap((y) => rule_row_cells(api, api.board[y] ?? [], y))
}

function group_positions(x: number, count: number): Array<number> {
	return Array.from({ length: count }, (_, k) => x + k * STRIDE)
}

// Each LED character's column: the ten centred in the window in the 3-4-3 grouping.
function positions_of(window_w: number): Array<number> {
	const counts = Array.from(GROUPS, Number)
	const width = THE_CODE.length * LED_W + (THE_CODE.length - counts.length) + GROUP_GAP * HALF
	const positions: Array<number> = []
	let x = Math.floor((window_w - width) / HALF)

	for (const [group, count] of counts.entries()) {
		positions.push(...group_positions(x, count))
		x += (count - 1) * STRIDE + LED_W + (group < counts.length - 1 ? GROUP_GAP : 0)
	}

	return positions
}

// The board's last row with text, the area's end when none follows it.
function last_row_of(api: ThemeApi): number {
	const { h, area_end } = api.layout
	let last = area_end

	for (const y of api.board.keys()) {
		if (y < h && api.plain(y).trim() !== '') last = y
	}

	return last
}

function sky_of(api: ThemeApi): Sky {
	const { layout } = api
	const sky = layout.area_top + 1

	return {
		layout,
		half: Math.floor(layout.edge / HALF),
		sky,
		bottom: layout.area_end,
		last_row: last_row_of(api),
		land_cells: land_cells_of(sky, false),
	}
}

// The three closing lines as one block centred in the area, a blank row between lines.
function closing_of(api: ThemeApi): Point {
	const { area_top, area_end, edge } = api.layout
	const widest = Math.max(...CLOSING.map((line) => line.length))
	const rows = CLOSING.length * HALF - 1

	return {
		x: Math.floor((edge - widest) / HALF),
		y: area_top + Math.floor((area_end - area_top + 1 - rows) / HALF),
	}
}

function screen_of(api: ThemeApi): Pick<Wopr, 'board_x' | 'screen' | 'tally_x' | 'window_w'> {
	const { level_spot } = api.layout
	const screen = { x0: level_spot.x - SCREEN.left, x1: level_spot.x - SCREEN.right }
	const room = screen.x1 - screen.x0 - 1 - BOARD_W

	return {
		screen,
		window_w: screen.x0 - 1,
		board_x: screen.x0 + 1 + Math.floor(room / HALF),
		tally_x: screen.x1 + SCREEN.tally,
	}
}

function sweep_of(mark_x: number): Sweep {
	return { y: SWEEP.y, left: Math.max(0, mark_x + SWEEP.reach - SWEEP.span), cells: SWEEP.cells }
}

// The theme's tables for the host's layout.
function wopr_of(api: ThemeApi): Wopr {
	const sky = sky_of(api)
	const screen = screen_of(api)
	const mark_x = mark_x_of(api)
	const table_x = sky.half + TABLE_MARGIN

	return {
		...sky,
		...screen,
		api,
		lamps: lamps_of(api),
		mark_x,
		sweep: sweep_of(mark_x),
		rule_cells: rule_cells_of(api),
		coast_cells: land_cells_of(sky.sky, true),
		positions: positions_of(screen.window_w),
		led_y: api.layout.area_top + 1,
		wars: wars_of(sky),
		table_at: table_at(),
		table: { rows: sky.bottom - sky.sky, x: table_x, w: api.layout.edge - TABLE_MARGIN - table_x },
		closing: closing_of(api),
		strip_x: api.layout.level_spot.x - STRIP_LEFT,
	}
}

const run_board_theme_wopr_place = {
	BOARD_W,
	CELL_W,
	CELLS_ACROSS,
	SCATTER_STEPS,
	positions_of,
	wopr_of,
}

export { run_board_theme_wopr_place }
export type { Lamps, RuleCell, Sweep, Wopr }
