import { run_board_theme_flux_data } from './run-board-theme-flux-data'
import type { Motion } from './run-board-theme-flux-motion'
import type { ThemeApi, ThemeLayout, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_rules } from './run-board-theme-rules'

// What the BTTF theme works out once for a board (joshuafolkken/kit#8917): the places the confirmed
// theme demo's `fixed-v21-theme-bttf.mjs` computed inside its `theme(api)` — the figure's corner, the
// header's clocks, the typed lines, the trails' rows, the rule rows — kept per factory call.

const { AMBER_ROWS, GEOMETRY, LED_COLUMNS } = run_board_theme_flux_data

const GAP = 2
const FLUX_WIDTH = (GEOMETRY.picture[0] ?? '').length
const FIGURE_WIDTH = FLUX_WIDTH + GAP + LED_COLUMNS
// A header clock: the demo's base dates it (`11-24 23:03`), the live header does not (`09:07`), and
// a destination with no estimate yet reads `--:--`; a start or finish a day or more from now reads its
// date alone (`11-25`, joshuafolkken/kit#8928).
const CLOCK = /\d\d-\d\d(?: \d\d:\d\d)?|(?:\d\d|--):(?:\d\d|--)/u
const TIMED = /\d\d:\d\d/u
const CLOCK_ROWS = 3
const NO_CLOCK = '11-24 00:00'
const NEXT_MINUTES = 37
const HOUR_MINUTES = 60
const DAY_MINUTES = 1440
const CLOCK_DIGITS = 2
const LAG_SHARE = 0.4
const LAG_ROWS = 27
// A trail runs on the gap row just above its rule.
const TRAIL_GAP_ABOVE = 1
const GAUGE_LAMPS = GEOMETRY.green_rows + AMBER_ROWS + 1
// The flashes and the sparks of a typed line: its burst comes back every 1.8 s.
const REPEAT_EVERY = 36
const PROGRESS_SALT = 7000
const NOTICE_SALT = 21_000
const PROGRESS_FLASH = 3
const NOTICE_WHITE = 4
const NOTICE_THAW = 30
const NOTICE_SPARKS = 6
const NOTICE_REACH = 22

interface Clock {
	x: number
	text: string
}

// What a set of clocks reads: the three times, and the next estimate the destination rolls to.
interface Face {
	texts: Array<string>
	next: string
}

// The line a channel types: its row, first column, the column after it, and where its flash starts.
// The notice's typing is the louder one: its letters hold white twice as long and thaw half again as
// slowly, twice the bolts crackle over a longer reach ahead of the cursor, and the cursor throws
// sparks off its head.
interface Line {
	y: number
	x: number
	end: number
	flash_from: number
	salt: number
	repeat?: number
	white?: number
	thaw?: number
	sparks?: number
	reach?: number
	throws?: boolean
}

interface Lines {
	progress: Line
	row: Line
	notice: Line
}

interface FluxContext {
	api: ThemeApi
	layout: ThemeLayout
	figure: { row: number; column: number }
	clocks: Array<Clock>
	// The header's clocks as it draws them, and the time circuits' — always dated, as the demo's are.
	header: Face
	circuits: Face
	// The NOTICE's large clock: the destination, or the last departure without an estimate.
	big: Face
	area_right: number
	lines: Lines
	trail_rows: Array<number>
	row_lag: number
	all_rows: Array<number>
	area_rows: Array<number>
	rule_rows: Array<number>
	green_end: number
	red_from: number
}

// What a drawing reads at a tick: the state, the motion worked out from it, and the tick.
interface Moment {
	state: ThemeState
	motion: Motion
	tick: number
}

function two_digits(value: number): string {
	return String(value).padStart(CLOCK_DIGITS, '0')
}

// The next estimate the destination rolls to after a jump, dated as the clock is; a clock that tells
// no time (`----- --:--`) stays as it reads.
function later(clock: string, minutes: number): string {
	if (!TIMED.test(clock)) return clock
	const date_end = clock.lastIndexOf(' ') + 1
	const [hours = 0, mins = 0] = clock.slice(date_end).split(':').map(Number)
	const total = (hours * HOUR_MINUTES + mins + minutes) % DAY_MINUTES

	return `${clock.slice(0, date_end)}${two_digits(Math.floor(total / HOUR_MINUTES))}:${two_digits(total % HOUR_MINUTES)}`
}

function clocks_of(api: ThemeApi): Array<Clock> {
	return Array.from({ length: CLOCK_ROWS }, (_, y) => {
		const found = CLOCK.exec(api.plain(y).slice(0, api.layout.head_left.w))

		return found ? { x: found.index, text: found[0] } : { x: -1, text: NO_CLOCK }
	})
}

// The clock the next estimate counts from: the destination, or the first that tells a time.
function timed_of(texts: Array<string>): string {
	return texts.find((text) => TIMED.test(text)) ?? NO_CLOCK
}

function face_of(texts: Array<string>): Face {
	return { texts, next: later(timed_of(texts), NEXT_MINUTES) }
}

// The time circuits' clocks: the board's own times dated where it gives them, else the header's.
function circuits_of(api: ThemeApi, clocks: Array<Clock>): Face {
	return face_of(api.layout.dated_clocks ?? clocks.map((clock) => clock.text))
}

// The NOTICE's large clock (joshuafolkken/kit#8917): the destination, or the last departure while no
// estimate tells one; it rolls but stops on the time it showed.
function big_of(circuits: Face): Face {
	const [destination = NO_CLOCK, , departed = NO_CLOCK] = circuits.texts
	const text = TIMED.test(destination) ? destination : departed

	return { texts: [text], next: text }
}

function lines_of(layout: ThemeLayout): Lines {
	const { notice, progress, row } = layout

	return {
		progress: { ...progress, flash_from: progress.x - PROGRESS_FLASH, salt: PROGRESS_SALT },
		row: { ...row, end: layout.w, flash_from: row.x - 1, salt: 0, repeat: REPEAT_EVERY },
		notice: {
			...notice,
			flash_from: notice.x - 1,
			salt: NOTICE_SALT,
			white: NOTICE_WHITE,
			thaw: NOTICE_THAW,
			sparks: NOTICE_SPARKS,
			reach: NOTICE_REACH,
			throws: true,
		},
	}
}

// The rows of the board's section rules, the rows the rule gauge lights: by the cells' role, so a live
// rule's fold marker (`V -- …`, `> -- …`) is one as the demo's `-- -- …` is (joshuafolkken/kit#8917).
function rule_rows_of(api: ThemeApi): Array<number> {
	return run_board_theme_rules.rule_rows_of(api.board)
}

function rows_of(layout: ThemeLayout): Pick<FluxContext, 'all_rows' | 'area_rows'> {
	const all_rows = Array.from({ length: layout.h }, (_, y) => y)

	return {
		all_rows,
		area_rows: all_rows.filter((y) => y >= layout.area_top && y <= layout.area_end),
	}
}

// The two gaps the trails run along: the one above the THROUGHPUT rule (the first) and the one above
// the LANES rule — found from kit's rules, so with no lane or a folded section both still run.
function trail_rows_of(api: ThemeApi): Array<number> {
	const [first] = rule_rows_of(api)
	const lanes = run_board_theme_rules.lanes_rule_at(api.layout, api.board)

	return [first, lanes].filter((y) => y !== undefined).map((y) => y - TRAIL_GAP_ABOVE)
}

function context_of(api: ThemeApi): FluxContext {
	const { layout } = api
	const { edge } = layout
	const clocks = clocks_of(api)
	const circuits = circuits_of(api, clocks)

	return {
		api,
		layout,
		figure: { row: layout.area_top + 1, column: edge - FIGURE_WIDTH },
		clocks,
		header: face_of(clocks.map((clock) => clock.text)),
		circuits,
		big: big_of(circuits),
		area_right: layout.px - 1,
		lines: lines_of(layout),
		trail_rows: trail_rows_of(api),
		row_lag: LAG_SHARE * Math.min(1, LAG_ROWS / layout.h),
		...rows_of(layout),
		rule_rows: rule_rows_of(api),
		green_end: Math.round((edge * GEOMETRY.green_rows) / GAUGE_LAMPS),
		red_from: Math.round((edge * (GEOMETRY.green_rows + AMBER_ROWS)) / GAUGE_LAMPS),
	}
}

// The notice and the progress words are never drawn on, only restyled.
function is_kept(layout: ThemeLayout, x: number, y: number): boolean {
	const { notice, progress } = layout

	if (y === notice.y) return x >= notice.x - 1 && x < notice.end

	return y === progress.y && x >= progress.x - PROGRESS_FLASH && x < progress.end
}

const run_board_theme_flux_context = {
	FIGURE_WIDTH,
	FLUX_WIDTH,
	GAP,
	GAUGE_LAMPS,
	context_of,
	is_kept,
	later,
}

export { run_board_theme_flux_context }
export type { Clock, Face, FluxContext, Line, Moment }
