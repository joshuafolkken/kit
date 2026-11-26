import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Cell, Grid, ThemeLayout } from './run-board-theme-host-types'
import {
	run_board_theme_magi_data,
	type Beat,
	type MagiPanel,
	type PanelLook,
} from './run-board-theme-magi-data'

// The MAGI theme's small drawing pieces (joshuafolkken/kit#8917), shared by its board, its opening
// and its ending: blinks, cell bars, the clock, the WARNING band, a panel and a pair of link cells.

const { BOLD, centered, fg, put, repeated, set_cell } = run_board_theme_host_grid
const { BAND } = run_board_theme_magi_data

const SIDES = 2
const LINK_LIT = '255;220;120'
const LINK_DARK = '110;55;0'
const CLOCK_DIGITS = 2
// The clock's whole seconds and its hundredths.
const CLOCK_PARTS = 2
const BLANK_CELL: Cell = [' ', 'body']

// A WARNING band along row `y`, marching by `dir`, from `x0` up to `x1` (0 and the screen's width).
interface BandLine {
	y: number
	dir: number
	tick: number
	x0?: number
	x1?: number
}

// Whether a blink of `beat` is lit at `tick`.
function is_lit(tick: number, beat: Beat): boolean {
	return tick % beat.every < beat.on
}

// The active limit as the clock shows it: minutes, seconds and hundredths.
function clock_text(left: number): string {
	const [whole = '', cents = ''] = left.toFixed(CLOCK_DIGITS).split('.', CLOCK_PARTS)

	return `00:${whole.padStart(CLOCK_DIGITS, '0')}:${cents}`
}

// The band's cell at `index`, the band repeating either way.
function band_cell(index: number): Cell {
	return BAND[((index % BAND.length) + BAND.length) % BAND.length] ?? BLANK_CELL
}

function band_row(grid: Grid, width: number, line: BandLine): void {
	const { y, dir, tick, x0 = 0, x1 = width } = line

	// set_cell leaves a row off the screen alone, as the demo's own check did.
	for (let x = Math.max(0, x0); x < Math.min(width, x1); x++) {
		set_cell(grid, { y, x }, band_cell(x + dir * tick))
	}
}

// The band on an edge of the board's middle rows: above the middle it marches right, below it left.
function edge_band(grid: Grid, layout: ThemeLayout, y: number, tick: number): void {
	band_row(grid, layout.w, { y, dir: y < layout.screen_cy ? 1 : -1, tick })
}

// A MAGI panel as the board draws one: the name in the frame's top, the status inside.
function magi_box(grid: Grid, panel: MagiPanel, look: PanelLook): void {
	const { name, x, y, w } = panel
	const frame = `${fg(look.frame)}${BOLD}`

	put(grid, { y, x }, `┌${name}${repeated('─', w - SIDES - name.length)}┐`, frame)
	put(grid, { y: y + 1, x }, `│${repeated(' ', w - SIDES)}│`, frame)
	put(grid, { y: y + 1, x: x + 1 }, centered(look.text, w - SIDES), look.fill)
	put(grid, { y: y + SIDES, x }, `└${repeated('─', w - SIDES)}┘`, frame)
}

// Two link cells on row `y`: one pointing right at `left`, one pointing left at `right`.
function link_pair(
	grid: Grid,
	y: number,
	xs: { left: number; right: number },
	is_on: boolean,
): void {
	const ink = fg(is_on ? LINK_LIT : LINK_DARK)

	put(grid, { y, x: xs.left }, is_on ? '▸' : '·', ink)
	put(grid, { y, x: xs.right }, is_on ? '◂' : '·', ink)
}

const run_board_theme_magi_draw = {
	band_cell,
	band_row,
	clock_text,
	edge_band,
	is_lit,
	link_pair,
	magi_box,
}

export { run_board_theme_magi_draw }
export type { BandLine }
