import { run_board_theme_deviant_data } from './run-board-theme-deviant-data'
import { run_board_theme_deviant_opening } from './run-board-theme-deviant-opening'
import { run_board_theme_deviant_parts } from './run-board-theme-deviant-parts'
import { run_board_theme_deviant_tables } from './run-board-theme-deviant-tables'
import { run_board_theme_draw, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { Cell, Grid, Point } from './run-board-theme-host-types'

// The deviant theme's results screen, the ENDING's middle: on the OPENING's ice-white light bars, a
// thin rule and the board's name as a large thin spaced title at the upper left, MISSION SUCCESSFUL
// typed under it as its status line; under them the run's own numbers, each a large numeral in blue
// over a small bold caption and a thin line, entering one after another, each joined to the one
// before by a right-angle connector with a `+`; a `·` closes the last line.
// The numbers are the board's: the lanes on it (`layout.lane_rows`), those running
// (`layout.lane_spin_rows`), the events the theme saw typed through (`state.done`) and the whole
// hours from the run's start to now (`layout.dated_clocks`; left out where the board gives none).

const { bg, code_points, put, repeated } = run_board_theme_host_grid
const { PAIR, share_of } = run_board_theme_draw
const { MODEL, RGB } = run_board_theme_deviant_data
const { faded, ice_at } = run_board_theme_deviant_opening
const { bold } = run_board_theme_deviant_parts
const { RESULTS } = run_board_theme_deviant_tables

const CLOCK = /^\d\d-\d\d \d\d:\d\d$/u
// Clocks carry no year: both are read in one that has no leap day.
const CLOCK_YEAR = '2001'
const HOUR_MS = 3_600_000
// The header's dated clocks: now, then the run's start.
const CLOCK_AT = { now: 1, start: 2 }
// The most a numeral shows.
const FIGURE_MAX = 999

// One number of the run: its caption, its numeral, and where it stands.
interface Figure {
	caption: string
	value: string
	x: number
	w: number
}

type Counted = Pick<Figure, 'caption' | 'value'>

// A figure as it enters: whether a connector leads to it, whether it closes the row.
interface Entry {
	found: Figure
	is_first: boolean
	is_last: boolean
}

// The board's name as the title: capitals, a space between its letters.
const TITLE = code_points(MODEL.board.toUpperCase()).join(' ')

function clock_ms(clock: string | undefined): number | undefined {
	if (clock === undefined || !CLOCK.test(clock)) return undefined
	const ms = Date.parse(`${CLOCK_YEAR}-${clock.replace(' ', 'T')}:00Z`)

	return Number.isNaN(ms) ? undefined : ms
}

function hours_between(start: number, now: number): number {
	const hours = Math.floor((now - start) / HOUR_MS)

	return hours < 0 ? hours + RESULTS.year_days * RESULTS.day_hours : hours
}

// The whole hours from the run's start to now, a start late in the year before taken a year back.
function hours_of(clocks: ReadonlyArray<string> | undefined): number | undefined {
	const now = clock_ms(clocks?.[CLOCK_AT.now])
	const start = clock_ms(clocks?.[CLOCK_AT.start])

	if (now === undefined || start === undefined) return undefined

	return hours_between(start, now)
}

function counted(caption: string, count: number): Counted {
	return { caption, value: String(Math.min(FIGURE_MAX, Math.max(0, count))) }
}

function counts_of(draw: ThemeDraw): Array<Counted> {
	const { layout } = draw.api
	const { captions } = RESULTS
	const hours = hours_of(layout.dated_clocks)

	return [
		counted(captions.lanes, layout.lane_rows.length),
		counted(captions.running, layout.lane_spin_rows.length),
		counted(captions.events, draw.s.done),
		...(hours === undefined ? [] : [counted(captions.hours, hours)]),
	]
}

// The numbers laid left to right, each as wide as its numeral or its caption; those the screen has no
// room for are left out.
function figures_of(draw: ThemeDraw): Array<Figure> {
	const { api } = draw
	const laid: Array<Figure> = []
	let { x } = RESULTS

	for (const { caption, value } of counts_of(draw)) {
		const width = Math.max(RESULTS.block_min, api.big_width(value), caption.length)

		if (x + width < api.layout.w) laid.push({ caption, value, x, w: width })
		x += width + RESULTS.block_gap
	}

	return laid
}

// The connector from the figure before: down from its line's end, along with a `+`, up into this one.
function connector(grid: Grid, at: Point, shown: number): void {
	const wire = faded(RGB.steel, shown)
	const run = RESULTS.block_gap - PAIR
	const middle = Math.floor(run / PAIR)
	const line = `${repeated('─', middle)}+${repeated('─', run - middle - 1)}`

	put(grid, { y: at.y, x: at.x - RESULTS.block_gap }, '┐', wire)
	put(grid, { y: at.y + 1, x: at.x - RESULTS.block_gap }, `└${line}┘`, wire)
	put(grid, { y: at.y, x: at.x - 1 }, '┌', wire)
}

// A figure `shown` of the way in from the ice: its numeral, its caption and its line.
function figure(draw: ThemeDraw, found: Figure, top: number, shown: number): void {
	const { api, grid } = draw
	const { x, w, caption, value } = found
	const below = top + RESULTS.digit_rows

	api.big_number(grid, { y: top, x }, value, { style: faded(RGB.blue, shown) })
	put(grid, { y: below, x }, caption, `${faded(RGB.ink, shown)}${run_board_theme_host_grid.BOLD}`)
	put(grid, { y: below + 1, x }, repeated('─', w), faded(RGB.steel, shown))
}

// A figure with what joins it to the row: the connector from the one before, a dot closing the last.
function joined(draw: ThemeDraw, entry: Entry, top: number, shown: number): void {
	const { found, is_first, is_last } = entry
	const line = top + RESULTS.digit_rows + 1

	figure(draw, found, top, shown)
	if (!is_first) connector(draw.grid, { y: line, x: found.x }, shown)
	if (is_last) put(draw.grid, { y: line, x: found.x + found.w }, '·', bold(RGB.steel))
}

// The figures due by `age`, one after another.
function figures(draw: ThemeDraw, top: number, age: number): void {
	const found = figures_of(draw)

	for (const [index, each] of found.entries()) {
		const shown = share_of(age, RESULTS.first_from + index * RESULTS.step, RESULTS.fade)
		const entry = { found: each, is_first: index === 0, is_last: index === found.length - 1 }

		if (shown > 0) joined(draw, entry, top, shown)
	}
}

// The rule over the title: a dot at each end and a cross along it.
function title_rule(shown: number): string {
	const glyphs = Array.from({ length: RESULTS.rule_w }, (_, index) => {
		if (index === 0 || index === RESULTS.rule_w - 1) return '·'

		return index === RESULTS.rule_cross ? '+' : '─'
	})

	return glyphs.slice(0, Math.ceil(shown * RESULTS.rule_w)).join('')
}

// The title block: its rule running out, the board's name spaced, and the status line as far as
// `age` has typed it.
function title(draw: ThemeDraw, top: number, age: number): void {
	const { grid } = draw
	const { x, word, rest } = RESULTS
	const shown = share_of(age, RESULTS.title_from, RESULTS.title_fade)

	if (shown <= 0) return
	const typed = Math.max(0, (age - RESULTS.status_from) * RESULTS.pace)
	const status = { y: top + RESULTS.status_row, x }

	put(grid, { y: top, x }, title_rule(shown), faded(RGB.steel, shown))
	put(grid, { y: top + RESULTS.title_row, x }, TITLE, faded(RGB.ink, shown))
	put(grid, status, word.slice(0, typed), bold(RGB.blue))
	put(
		grid,
		{ ...status, x: x + word.length + 1 },
		rest.slice(0, Math.max(0, typed - word.length)),
		faded(RGB.steel, 1),
	)
}

// A row's cells each on its own column's ice, what was drawn keeping its ink.
function grounded(row: ReadonlyArray<Cell>, columns: ReadonlyArray<string>): Array<Cell> {
	return row.map(([ch, style], x) => [ch, `${style}${columns[x] ?? ''}`])
}

// The results screen `age` ticks into the ENDING, over the whole screen: drawn in ink alone on an
// emptied screen, then laid on the light bars.
function results(draw: ThemeDraw, age: number): void {
	const { grid } = draw
	const columns = (grid[0] ?? []).map((_, x) => bg(ice_at(x, 1)))

	for (const row of grid) row.splice(0, row.length, ...row.map((): Cell => [' ', '']))
	title(draw, RESULTS.top, age)
	figures(draw, RESULTS.top + RESULTS.numbers_row, age)
	for (const row of grid) row.splice(0, row.length, ...grounded(row, columns))
}

const run_board_theme_deviant_results = { results }

export { run_board_theme_deviant_results }
