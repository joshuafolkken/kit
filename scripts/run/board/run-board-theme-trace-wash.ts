import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { ThemeState } from './run-board-theme-host-types'
import { run_board_theme_trace_data, type TraceView } from './run-board-theme-trace-data'
import { run_board_theme_trace_pour, type Shape } from './run-board-theme-trace-pour'

// MATRIX's wash and its drop a second (joshuafolkken/kit#8917), from the confirmed theme demo: the
// notice's pour washing the THROUGHPUT and USAGE area away, and the one drop born on each whole
// second while no rain pours.

const { set_cell } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { NOTICE_END, PEAK_TICKS, TICK_MS, active } = run_board_theme_host_state
const { IDLE, KEYS, PROGRESS_TAIL, SALT, SECOND_PACE_SALT, SECOND_SALTS } =
	run_board_theme_trace_data
const { REACH_SCREENS, draw_fall, falls_of, notice_pour_of, shape_of, typing_end } =
	run_board_theme_trace_pour

const MS_PER_SECOND = 1000

// The rows of a column the notice's drops have reached: the lowest head, the highest tail.
interface Marks {
	first: number
	last: number
}

function is_washing(view: TraceView): boolean {
	const { notice } = view.s

	return notice.index >= 0 && view.tick >= notice.start && active(notice, NOTICE_END)
}

function mark(reached: Map<number, Marks>, shape: Shape): void {
	const marks = reached.get(shape.x) ?? { first: -1, last: Infinity }

	marks.first = Math.max(marks.first, Math.floor(shape.row))
	marks.last = Math.min(marks.last, Math.floor(shape.row) - shape.trail)
	reached.set(shape.x, marks)
}

function reached_of(view: TraceView): Map<number, Marks> {
	const pour = notice_pour_of(view.s.notice)
	const rows = view.grid.length
	const reached = new Map<number, Marks>()

	for (const fall of falls_of(pour, pour.from, pour.to)) {
		const { x, trail, row } = shape_of(view.layout, fall, rows, view.tick)

		if (x < view.layout.edge) mark(reached, { x, trail, row })
	}

	return reached
}

// The notice's pour washes the THROUGHPUT and USAGE area away: a cell of it is blank once a drop's
// head has passed it, and stays blank until the tail of the column's last drop has gone by.
function wash_area(view: TraceView): void {
	if (!is_washing(view)) return
	const { area_top, area_end } = view.layout

	for (const [x, { first, last }] of reached_of(view)) {
		const bottom = Math.min(area_end, first)

		for (let y = Math.max(area_top, last); y <= bottom; y++) {
			set_cell(view.grid, { y, x }, [' ', 'body'])
		}
	}
}

function is_progress_pouring(state: ThemeState, tick: number): boolean {
	const { progress } = state

	return (
		progress.index >= 0 &&
		tick >= progress.start &&
		tick < typing_end(progress, state.tick) + PROGRESS_TAIL
	)
}

function is_row_pouring(state: ThemeState, tick: number): boolean {
	const { row } = state

	return row.index >= 0 && tick >= row.start && tick < typing_end(row, state.tick)
}

function is_notice_pouring(state: ThemeState, tick: number): boolean {
	const { notice } = state

	return notice.index >= 0 && tick >= notice.start && tick < notice.start + PEAK_TICKS + NOTICE_END
}

function is_pouring_at(state: ThemeState, tick: number): boolean {
	return (
		is_progress_pouring(state, tick) ||
		is_row_pouring(state, tick) ||
		is_notice_pouring(state, tick)
	)
}

// One drop born on each whole second, at the idle rain's paces, none while the rain pours.
function draw_seconds(view: TraceView): void {
	const now = Math.floor((view.tick * TICK_MS) / MS_PER_SECOND)
	const per_second = MS_PER_SECOND / TICK_MS
	const reach = Math.ceil((REACH_SCREENS * view.grid.length) / IDLE.pace.least / per_second) + 1

	for (let second = now - reach; second <= now; second++) {
		const born = (second * MS_PER_SECOND) / TICK_MS

		if (is_pouring_at(view.s, born)) continue
		const pace = IDLE.pace.least + hash(second, SECOND_PACE_SALT, SALT.second) * IDLE.pace.spread
		const key = second * KEYS.per_second + KEYS.second_offset

		draw_fall(view, { key, born, pace, salts: SECOND_SALTS })
	}
}

const run_board_theme_trace_wash = { draw_seconds, is_pouring_at, wash_area }

export { run_board_theme_trace_wash }
