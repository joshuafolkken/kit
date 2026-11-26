import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import { run_board_theme_host_fonts } from './run-board-theme-host-fonts'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Channel, Grid, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_magi_data, type MagiKit } from './run-board-theme-magi-data'
import { run_board_theme_magi_draw } from './run-board-theme-magi-draw'

// The MAGI theme's NOTICE effect (joshuafolkken/kit#8917), ported from the confirmed theme demo:
// EMERGENCY in tall letters takes the area, the order and PATTERN BLUE overflow into the header, and
// WARNING bands march along every gap between the sections.

const { banner } = run_board_theme_host_fonts
const { BOLD, bg, block, centered, fg, put, repeated, set_cell } = run_board_theme_host_grid
const { active, NOTICE_END } = run_board_theme_host_state
const { trace_on } = run_board_theme_host_flash
const { BLINK, EMERGENCY_LINES, ORANGE, ORANGE_ON, RED_BOLD, RED_ON } = run_board_theme_magi_data
const { STRIPES, WHITE } = run_board_theme_magi_data
const { band_cell, band_row, is_lit } = run_board_theme_magi_draw

// The report's label column, its width and its value's column; the tall letters take the limit's row to
// the power's.
const REPORT = { x: 2, width: 14, value: 17, lines: 4, red_line: 2 }
// The header's three rows. The stripes in its left block take the first and the last; the offset
// keeps their index positive.
const HEADER = { top: 0, middle: 1, bottom: 2 }
const STRIPE_ROWS = [HEADER.top, HEADER.bottom]
const STRIPE_OFFSET = 4000
const HALF = 2

interface ReportLine {
	row: number
	name: string
	value: string
	ink: string
}

// The report's lines type in beneath the letters as the notice builds, a quarter at a time.
function is_shown(notice: Channel, row: number): boolean {
	return !notice.is_typing || notice.length >= (notice.total * (row + 1)) / REPORT.lines
}

function report_line(grid: Grid, line: ReportLine & { low: number }, tick: number): void {
	const y = line.low + line.row
	const is_red = line.row === REPORT.red_line && is_lit(tick, BLINK.fast)

	put(grid, { y, x: REPORT.x }, `${line.name} `.padEnd(REPORT.width, '.'), ORANGE)
	put(grid, { y, x: REPORT.value }, line.value, is_red ? RED_ON : line.ink)
}

function emergency_report(kit: MagiKit, grid: Grid, state: ThemeState, tick: number): void {
	const { low } = kit.rows

	for (const [row, line] of EMERGENCY_LINES.entries()) {
		if (is_shown(state.notice, row)) report_line(grid, { row, low, ...line }, tick)
	}
}

// The tall letters flicker while the notice builds, then light with the trace's bars.
function letters_style(state: ThemeState, tick: number): string {
	const is_on = state.notice.is_typing ? is_lit(tick, BLINK.slow) : trace_on(state)

	return is_on ? RED_ON : RED_BOLD
}

// EMERGENCY in tall letters on three rows lit in its style.
function emergency_letters(kit: MagiKit, grid: Grid, width: number, style: string): void {
	const { limit: top, power: bottom } = kit.rows

	for (let y = top; y <= bottom; y++) put(grid, { y, x: 0 }, repeated(' ', width), style)

	banner(grid, { x: 0, w: width, top }, 'EMERGENCY', style)
}

// A notice arriving takes the area first: left of the panel, EMERGENCY in tall letters between two
// marching bands, and the report typing in beneath it.
function emergency_screen(kit: MagiKit, grid: Grid, state: ThemeState, tick: number): void {
	if (!active(state.notice, NOTICE_END)) return
	const { api, sync_end } = kit
	const area = { x: 0, w: sync_end - 1 }
	const style = letters_style(state, tick)

	api.clear_area(grid, 0, sync_end)
	band_row(grid, api.layout.w, { y: api.layout.area_top, dir: 1, tick, x0: 0, x1: area.w })
	band_row(grid, api.layout.w, { y: kit.rows.links, dir: -1, tick, x0: 0, x1: area.w })
	emergency_letters(kit, grid, area.w, style)
	emergency_report(kit, grid, state, tick)
}

function stripe_row(grid: Grid, row: { y: number; w: number; shift: number }, ink: string): void {
	for (let x = 0; x < row.w; x++) {
		const ch = STRIPES.charAt((x + row.shift + STRIPE_OFFSET) % HALF)

		set_cell(grid, { y: row.y, x }, [ch, ink])
	}
}

// Hazard stripes round the order on the left.
function hazard_stripes(kit: MagiKit, grid: Grid, tick: number): void {
	const { w } = kit.api.layout.head_left
	const ink = `${fg('255;40;30')}${BOLD}`

	for (const y of STRIPE_ROWS) {
		stripe_row(grid, { y, w, shift: y === HEADER.top ? -tick : tick }, ink)
	}

	put(
		grid,
		{ y: HEADER.middle, x: 0 },
		centered('ALL HANDS · FIRST STAGE ALERT', w),
		is_lit(tick, BLINK.slow) ? RED_ON : ORANGE_ON,
	)
}

// PATTERN BLUE on the right.
function pattern_blue(kit: MagiKit, grid: Grid, tick: number): void {
	const { head_right } = kit.api.layout
	const { x, w } = head_right
	const blue = `${fg('120;190;255')}${BOLD}`
	const blue_on = `${fg(WHITE)}${BOLD}${bg('30;90;230')}`

	block(grid, head_right, blue)
	put(grid, { y: HEADER.top, x }, centered('PATTERN', w), blue)
	put(grid, { y: HEADER.middle, x }, centered('BLUE', w), is_lit(tick, BLINK.fast) ? blue_on : blue)
	put(grid, { y: HEADER.bottom, x }, centered('UNIDENTIFIED', w), blue)
}

// The WARNING band along the gauge row, its pattern counted from the row's first column.
function gauge_band(kit: MagiKit, grid: Grid, tick: number): void {
	const { head_top } = kit.api.layout

	for (let x = 0; x < head_top.w; x++) {
		set_cell(grid, { y: HEADER.top, x: head_top.x + x }, band_cell(x + tick))
	}
}

// The area is full, so the alert overflows into the header: hazard stripes round the order on the
// left, PATTERN BLUE on the right, and a WARNING band along the gauge row.
function emergency_header(kit: MagiKit, grid: Grid, state: ThemeState, tick: number): void {
	if (!active(state.notice, NOTICE_END)) return
	hazard_stripes(kit, grid, tick)
	pattern_blue(kit, grid, tick)
	gauge_band(kit, grid, tick)
}

// Neighboring gaps' bands march opposite ways.
function band_direction(row: number): number {
	return row % HALF === 1 ? 1 : -1
}

// A notice arriving: WARNING bands march along every gap between the sections. They march while the
// notice builds, then show with each bar of the trace.
function warning_bands(kit: MagiKit, grid: Grid, state: ThemeState, tick: number): void {
	if (!state.notice.is_typing && !trace_on(state)) return
	const { edge, gap_rows, w } = kit.api.layout

	for (const [row, y] of gap_rows.entries()) {
		band_row(grid, w, { y, dir: band_direction(row), tick, x0: 0, x1: edge })
	}
}

const run_board_theme_magi_alert = {
	band_direction,
	emergency_header,
	emergency_screen,
	warning_bands,
}

export { run_board_theme_magi_alert }
