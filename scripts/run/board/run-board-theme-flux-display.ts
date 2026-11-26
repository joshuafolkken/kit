import { run_board_theme_flux_clocks, type ClockChar } from './run-board-theme-flux-clocks'
import type { FluxContext, Moment } from './run-board-theme-flux-context'
import { run_board_theme_flux_data, type Rgb } from './run-board-theme-flux-data'
import { run_board_theme_flux_motion } from './run-board-theme-flux-motion'
import { run_board_theme_flux_paint } from './run-board-theme-flux-paint'
import { run_board_theme_host_fonts } from './run-board-theme-host-fonts'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Cell, Grid, Point } from './run-board-theme-host-types'
import { run_board_theme_rules } from './run-board-theme-rules'

// The BTTF theme's large display (joshuafolkken/kit#8917): late in the NOTICE's build the area left of
// the panel becomes the destination time and the speed in large digits. Ported from the confirmed
// theme demo's `fixed-v21-theme-bttf.mjs`.

const { char_color, clock_chars, is_dark_at } = run_board_theme_flux_clocks
const { BODY, DESTINATION, DIM, RULE, SPEED_COLOR, WHITE } = run_board_theme_flux_data
const { TOP_SPEED } = run_board_theme_flux_motion
const { paint, scaled } = run_board_theme_flux_paint
const { big_digit, big_number } = run_board_theme_host_fonts
const { BOLD, put, repeated } = run_board_theme_host_grid

const AREA_FROM = -45
const AREA_UNTIL = 60
// The columns the area's left side comes back by a tick: half again the demo's 13 (a kit-only touch,
// joshuafolkken/kit#8917); it holds the whole picture until AREA_UNTIL as before.
const AREA_REVEAL = 20
const BIG_X = 14
const DIGIT_STEP = 4
const SMALL_STEP = 2
const SPEED_DIGITS = 4
const BLINK = 2
const LABEL_X = 2
const TITLE_X = 6
const LABEL_ROW = 2
const SPEED_RULE = 4
const SPEED_ROW = 5
const MPH_ROW = 6
const DIGIT = /\d/u
const BLANK_GLYPH = [' ', ' ', ' ']
const SMALL_GLYPHS: ReadonlyMap<string, Array<string>> = new Map([
	['-', [' ', '━', ' ']],
	[':', [' ', '●', '●']],
	[' ', BLANK_GLYPH],
])

// The large clock's characters at row `y`, in the circuit's color.
interface BigClock {
	y: number
	chars: Array<ClockChar>
	color: Rgb
	is_dark: boolean
}

function small_glyph(grid: Grid, at: Point, ch: string, ink: string): void {
	const glyph = SMALL_GLYPHS.get(ch) ?? BLANK_GLYPH

	for (const [row, part] of glyph.entries()) put(grid, { y: at.y + row, x: at.x }, part, ink)
}

// One character of the large clock at `at`; the columns it takes.
function big_char(grid: Grid, at: Point, ch: string, ink: string): number {
	if (!DIGIT.test(ch)) {
		small_glyph(grid, at, ch, ink)

		return SMALL_STEP
	}

	big_digit(grid, at, ch, { style: ink })

	return DIGIT_STEP
}

// No unlit "8" behind the digits: it made the large clock read as another time.
function big_clock(grid: Grid, clock: BigClock): void {
	let x = BIG_X

	for (const each of clock.chars) {
		const ink = paint(char_color(each, clock.color, clock.is_dark)) + BOLD

		x += big_char(grid, { y: clock.y, x }, each.ch, ink)
	}
}

// The title's column on row `y`: a board's rule keeps its own lead (a live rule's fold marker,
// joshuafolkken/kit#8917) and is titled on its label's column; another row takes the demo's lead.
function title_x_of(context: FluxContext, grid: Grid, y: number): number {
	const { board } = context.api

	if (run_board_theme_rules.is_rule_row(board, y)) {
		return run_board_theme_rules.retitled_lead(grid, board, { y, style: paint(RULE) })
	}

	put(grid, { y, x: 0 }, '-- -- ', paint(RULE))

	return TITLE_X
}

function area_rule(context: FluxContext, grid: Grid, y: number, title: string): void {
	const x = title_x_of(context, grid, y)
	const rest = context.area_right - x - 1 - title.length

	put(grid, { y, x }, `${title} `, paint(BODY))
	put(grid, { y, x: x + 1 + title.length }, repeated('-', rest), paint(RULE))
}

function destination_part(context: FluxContext, grid: Grid, moment: Moment): void {
	const top = context.layout.area_top
	const chars = clock_chars(context, moment, 0, context.big)
	const is_dark = is_dark_at(moment.tick)

	area_rule(context, grid, top, 'DESTINATION TIME')
	put(grid, { y: top + LABEL_ROW, x: LABEL_X }, 'DEST', paint(scaled(DESTINATION, DIM)))
	big_clock(grid, { y: top + 1, chars, color: DESTINATION, is_dark })
}

function speed_part(context: FluxContext, grid: Grid, moment: Moment): void {
	const top = context.layout.area_top
	const speed = moment.motion.speed_at(moment.tick)
	const is_top = speed >= TOP_SPEED && moment.tick % BLINK === 0
	const ink = paint(is_top ? WHITE : SPEED_COLOR) + BOLD
	const text = Math.min(TOP_SPEED, speed).toFixed(1).padStart(SPEED_DIGITS, '0')

	area_rule(context, grid, top + SPEED_RULE, 'SPEED')
	put(grid, { y: top + MPH_ROW, x: LABEL_X }, 'MPH', paint(scaled(SPEED_COLOR, DIM)))
	big_number(grid, { y: top + SPEED_ROW, x: BIG_X }, text, { style: ink })
}

function is_shown(t: number | undefined): t is number {
	return t !== undefined && t >= AREA_FROM && t < AREA_UNTIL
}

// The cells right of `reach` the display has not reached yet go back as they were.
function restore(grid: Grid, top: number, reach: number, kept: Array<Array<Cell>>): void {
	for (const [row, cells] of kept.entries()) {
		grid[top + row]?.splice(reach, cells.length, ...cells)
	}
}

// Late in the build the area left of the panel becomes the time circuit and the speed in large
// digits; it comes in from the left at the trails' pace and stays until the board has thawed.
function big_display(context: FluxContext, grid: Grid, moment: Moment): void {
	const { t } = moment.motion

	if (!is_shown(t)) return
	const { area_end, area_top } = context.layout
	const reach = (t - AREA_FROM + 1) * AREA_REVEAL
	const rows = grid.slice(area_top, area_end + 1)
	const kept = rows.map((row) => row.slice(reach, context.area_right))

	context.api.clear_area(grid, 0, context.area_right)
	destination_part(context, grid, moment)
	speed_part(context, grid, moment)
	restore(grid, area_top, reach, kept)
}

const run_board_theme_flux_display = { AREA_UNTIL, big_display }

export { run_board_theme_flux_display }
