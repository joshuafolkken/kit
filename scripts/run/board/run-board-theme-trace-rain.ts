import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Point, Span } from './run-board-theme-host-types'
import {
	run_board_theme_trace_data,
	type Column,
	type Drop,
	type TraceView,
} from './run-board-theme-trace-data'
import { run_board_theme_trace_paint } from './run-board-theme-trace-paint'

// MATRIX's rain painter and its idle panel rain (joshuafolkken/kit#8917), from the confirmed theme
// demo: one drop's cells painted down a column (`paint_column`), the cells no rain may touch, and
// the panel's rain (run-board-idle-rain.ts).

const { cell_at, set_cell } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { NOTICE_END, TICK_MS, active } = run_board_theme_host_state
const { HEADER_ROWS, IDLE, IDLE_SALT, LIT_TRAIL, POUR, SALT } = run_board_theme_trace_data
const { BRIGHT_ON, HEAD_ON, glyph_at, paint_at } = run_board_theme_trace_paint

// The notice keeps the cell before its text clear; the progress line its icon and a margin.
const NOTICE_MARGIN = 1
const PROGRESS_MARGIN = 3

function in_span(span: Span, at: Point, margin: number): boolean {
	return at.y === span.y && at.x >= span.x - margin && at.x <= span.end
}

function is_header_held(view: TraceView, y: number): boolean {
	return y < HEADER_ROWS && !active(view.s.notice, NOTICE_END)
}

function is_row_typing(view: TraceView, y: number): boolean {
	return y === view.layout.row.y && view.s.row.is_typing
}

// The cells no rain may touch: the notice and progress text (with the icon and a margin), the
// header outside a NOTICE, and the lane row while it decodes.
function may_paint(view: TraceView, x: number, y: number): boolean {
	const at = { x, y }

	return !(
		in_span(view.layout.notice, at, NOTICE_MARGIN) ||
		in_span(view.layout.progress, at, PROGRESS_MARGIN) ||
		is_header_held(view, y) ||
		is_row_typing(view, y)
	)
}

// The notice's blinking band: its text and the cell before it (the host's `notice_trace`).
function in_notice_band(view: TraceView, at: Point): boolean {
	const { span, total } = view.s.notice_text

	return at.y === span.y && at.x >= span.x - NOTICE_MARGIN && at.x <= span.x + total
}

// The cells no drop may touch: a kit-only touch over the demo (joshuafolkken/kit#8917) — the rain
// keeps off the notice's blinking band only, so it falls on the rest of the notice row and on the
// progress line too; the header outside a NOTICE and the decoding lane row stay clear as before.
function may_rain(view: TraceView, x: number, y: number): boolean {
	return !(in_notice_band(view, { x, y }) || is_header_held(view, y) || is_row_typing(view, y))
}

function lit_paint(distance: number): string {
	return distance === 0 ? HEAD_ON : BRIGHT_ON
}

// One cell of a drop: code in a blank (or anywhere when it covers), else the cell's own character
// lit — the head in head white, the next two in bright.
function paint_cell(view: TraceView, at: Point, drop: Drop, distance: number): void {
	const [ch] = cell_at(view.grid, at.y, at.x)

	if (ch === ' ' || drop.covers === true) {
		set_cell(view.grid, at, [
			glyph_at(at.x, at.y, distance, drop.frame),
			paint_at(distance, drop.trail),
		])
	} else if (distance <= LIT_TRAIL) set_cell(view.grid, at, [ch, lit_paint(distance)])
}

function is_in_reach(view: TraceView, area: Column, y: number): boolean {
	const bottom = Math.min(area.top + area.rows, view.grid.length)

	if (y < area.top || y >= bottom) return false

	return area.guard !== true || may_rain(view, area.x, y)
}

// Paints one drop's cells in `area`'s column.
function paint_column(view: TraceView, area: Column, drop: Drop): void {
	const head = Math.floor(drop.row)

	for (let distance = 0; distance <= drop.trail; distance++) {
		const y = area.top + head - distance

		if (is_in_reach(view, area, y)) paint_cell(view, { x: area.x, y }, drop, distance)
	}
}

// A panel column's drop at `frame`: its gap and pace its own, all at the pour's pace in a burst.
function idle_heads_fixed(
	column: number,
	frame: number,
	is_burst: boolean,
	rows: number,
): { row: number; trail: number } {
	const gap_seed = hash(column, IDLE_SALT.gap, SALT.idle)
	const gap = IDLE.gap.least + Math.floor(gap_seed * IDLE.gap.spread)
	const cycle = rows + IDLE.trail + gap
	const pace = is_burst
		? (POUR.least * IDLE.frame_ms) / TICK_MS
		: IDLE.pace.least + hash(column, IDLE_SALT.pace, SALT.idle) * IDLE.pace.spread

	return {
		row: (frame * pace + hash(column, IDLE_SALT.phase, SALT.idle) * cycle) % cycle,
		trail: IDLE.trail,
	}
}

// The panel's rain: every other column of its rows; while a line types every drop runs fast.
function draw_idle(view: TraceView): void {
	const { layout, s } = view
	const frame = Math.floor((view.tick * TICK_MS) / IDLE.frame_ms)
	const is_burst = s.progress.is_typing || s.row.is_typing
	const top = layout.area_top + IDLE.top
	const rows = layout.area_end - top + 1

	for (let x = layout.px; x < layout.edge; x += IDLE.pitch) {
		const { row, trail } = idle_heads_fixed(x, frame, is_burst, rows)

		paint_column(view, { x, top, rows }, { row, trail, frame, covers: true })
	}
}

const run_board_theme_trace_rain = { draw_idle, idle_heads_fixed, may_paint, paint_column }

export { run_board_theme_trace_rain }
