import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Channel, ThemeLayout, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_trace_data, type TraceView } from './run-board-theme-trace-data'
import { run_board_theme_trace_rain } from './run-board-theme-trace-rain'

// MATRIX's board drops and pours (joshuafolkken/kit#8917), from the confirmed theme demo
// (run-board-rain-drop.ts, run-board-rain-pour.ts): the drops a typed place pours down the board,
// the wash the notice's pour leaves in the panel, and the drop born each second while none pours.

const { hash } = run_board_theme_host_hash
const { PEAK_TICKS } = run_board_theme_host_state
const { DROP_FILM, DROP_SALT, FILM_SALT_SHIFT, KEYS, NOTICE_POUR, POUR } =
	run_board_theme_trace_data
const { POUR_JITTER, POUR_SALT, PROGRESS_RAIN, PROGRESS_TAIL, SALT } = run_board_theme_trace_data
const { paint_column } = run_board_theme_trace_rain

const SECOND_TICKS = 20
const HALF = 2
// A drop is drawn until its tail is past the board: twice the board's rows at its slowest pace.
const REACH_SCREENS = 2

// A board drop: its noise key, the tick it was born, its pour's end, its pace, the salts its column
// and its trail are picked with, and whether it paints code over the board.
interface Fall {
	key: number
	born: number
	end?: number
	pace: number
	salts: { x: number; film: number }
	covers?: boolean | undefined
}

// A pour: its drops are born from `from` up to `to`, `count` a step.
interface Pour {
	salt: number
	from: number
	to: number
	count: (step: number) => number
	covers?: (step: number) => boolean
}

interface Shape {
	x: number
	trail: number
	row: number
}

// The extra rows a poured drop has fallen, in units of its pace, once its pour has ended: one more
// pace each second, so the pour clears quickly.
function gained(tick: number, end: number): number {
	const after = Math.max(0, tick - end)
	const seconds = Math.floor(after / SECOND_TICKS)

	return (SECOND_TICKS * seconds * (seconds - 1)) / HALF + seconds * (after % SECOND_TICKS)
}

// A board drop's shape at `tick`: its column, its trail and the row its head is on.
function shape_of(layout: ThemeLayout, fall: Fall, rows: number, tick: number): Shape {
	const x = 1 + Math.floor(hash(fall.key, fall.salts.x, SALT.drop) * (layout.w - 1))
	const film = DROP_FILM.least + hash(fall.key, fall.salts.film, SALT.drop) * DROP_FILM.spread
	const trail = Math.round(rows * film)
	const row = (tick - fall.born + gained(tick, fall.end ?? Infinity)) * fall.pace

	return { x, trail, row }
}

function draw_fall(view: TraceView, fall: Fall): void {
	const rows = view.grid.length
	const { x, trail, row } = shape_of(view.layout, fall, rows, view.tick)

	if (row < 0 || row - trail >= rows) return
	paint_column(
		view,
		{ x, top: 0, rows, guard: true },
		{ row, trail, frame: view.tick, covers: fall.covers },
	)
}

function typing_end(typed: Channel, tick: number): number {
	return typed.is_typing ? tick + 1 : tick - typed.cooled
}

// A NOTICE's pour: growing over the build, a burst over the text at the peak, then falling away.
function notice_pour(step: number, peak: number): number {
	const jitter = hash(step, POUR_JITTER.notice, SALT.pour)
	const { least, most, burst, burst_steps, after, after_steps } = NOTICE_POUR

	if (step < peak) {
		return Math.floor(least + ((most - least) * (step - peak + PEAK_TICKS)) / PEAK_TICKS + jitter)
	}

	if (step < peak + burst_steps) return burst

	return Math.floor(after * (1 - (step - peak - burst_steps) / after_steps) + jitter)
}

function notice_pour_of(notice: Channel): Pour {
	const peak = notice.start + PEAK_TICKS
	const burst_end = peak + NOTICE_POUR.burst_steps

	return {
		salt: POUR_SALT.notice,
		from: notice.start,
		to: burst_end + NOTICE_POUR.after_steps,
		count: (step) => notice_pour(step, peak),
		covers: (step) => step >= peak && step < burst_end,
	}
}

function progress_pour_of(progress: Channel, tick: number): Pour {
	return {
		salt: POUR_SALT.progress,
		from: progress.start,
		to: typing_end(progress, tick) + PROGRESS_TAIL,
		count: (step) => (hash(step, POUR_JITTER.progress, SALT.pour) < PROGRESS_RAIN ? 1 : 0),
	}
}

function row_pour_of(row: Channel, tick: number): Pour {
	return {
		salt: POUR_SALT.row,
		from: row.start,
		to: typing_end(row, tick),
		count: () => POUR.per_step,
	}
}

// The pours a state holds, quietest first: a progress line's light rain, a lane's pour, a notice's.
function pours_of(state: ThemeState, tick: number): Array<Pour> {
	const pours: Array<Pour> = []
	const { progress, row, notice } = state

	if (progress.index >= 0) pours.push(progress_pour_of(progress, tick))
	if (row.index >= 0) pours.push(row_pour_of(row, tick))
	if (notice.index >= 0) pours.push(notice_pour_of(notice))

	return pours
}

function pour_pace(key: number): number {
	return Math.max(
		(POUR.least + hash(key, DROP_SALT.pace, SALT.drop) * POUR.spread) * POUR.gain,
		POUR.floor,
	)
}

function step_falls(pour: Pour, step: number): Array<Fall> {
	return Array.from({ length: pour.count(step) }, (_, nth) => {
		const key = step * KEYS.per_step + nth

		return {
			key,
			born: step,
			end: pour.to,
			pace: pour_pace(key),
			salts: { x: pour.salt, film: pour.salt + FILM_SALT_SHIFT },
			covers: pour.covers?.(step),
		}
	})
}

// Every drop of a pour born from `from` up to (not including) `to`, past or still to come.
function falls_of(pour: Pour, from: number, to: number): Array<Fall> {
	const falls: Array<Fall> = []

	for (let step = Math.max(pour.from, from); step < Math.min(pour.to, to); step++) {
		falls.push(...step_falls(pour, step))
	}

	return falls
}

function draw_pour(view: TraceView): void {
	const reach = Math.ceil((REACH_SCREENS * view.grid.length) / POUR.floor)

	for (const pour of pours_of(view.s, view.tick)) {
		const falls = falls_of(pour, view.tick - reach, view.tick + 1)

		for (const fall of falls) draw_fall(view, fall)
	}
}

const run_board_theme_trace_pour = {
	REACH_SCREENS,
	draw_fall,
	draw_pour,
	falls_of,
	gained,
	notice_pour,
	notice_pour_of,
	pours_of,
	shape_of,
	typing_end,
}

export { run_board_theme_trace_pour }
export type { Fall, Pour, Shape }
