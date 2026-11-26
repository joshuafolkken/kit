import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import type { ThemeApi, ThemeModule } from './run-board-theme-host-types'
import { run_board_theme_trace_clock } from './run-board-theme-trace-clock'
import {
	run_board_theme_trace_data,
	type TraceBoard,
	type TraceView,
} from './run-board-theme-trace-data'
import { run_board_theme_trace_decode } from './run-board-theme-trace-decode'
import { run_board_theme_trace_flash } from './run-board-theme-trace-flash'
import { run_board_theme_trace_gauge } from './run-board-theme-trace-gauge'
import { run_board_theme_trace_intro } from './run-board-theme-trace-intro'
import { run_board_theme_trace_pass } from './run-board-theme-trace-pass'
import { run_board_theme_trace_pour } from './run-board-theme-trace-pour'
import { run_board_theme_trace_rain } from './run-board-theme-trace-rain'
import { run_board_theme_trace_wash } from './run-board-theme-trace-wash'

// MATRIX (joshuafolkken/kit#8917), the board's own code-rain theme, ported from the confirmed theme
// demo (`fixed-v21-theme-matrix.mjs`). The rain's motion is the approved demos' (the idle panel
// rain, the drop a second and the pour; the reveal rain and its glint); the typing glow, decode,
// change flash, notice lock, deja vu and TRACE gauge are built from main's numbers. Every drawing
// is a function of the state and the tick.

const { BOLD, bg, fg } = run_board_theme_host_grid
const { notice_trace, peak_flash } = run_board_theme_host_flash
const { COLORS, SHADE } = run_board_theme_trace_data
const { clock_fields, clock_flash, lay_clocks } = run_board_theme_trace_clock
const { decode, notice_lock, type_glow } = run_board_theme_trace_decode
const { change_flash, deja_vu } = run_board_theme_trace_flash
const { dark_dashes, trace_gauge } = run_board_theme_trace_gauge
const { ending_of, opening_of } = run_board_theme_trace_intro
const { draw_pour } = run_board_theme_trace_pour
const { draw_idle } = run_board_theme_trace_rain
const { draw_seconds, wash_area } = run_board_theme_trace_wash

const PEAK_INK = '0;40;10'

// The new lane's last character: the decode runs up to it.
function row_last(api: ThemeApi): number {
	const { row } = api.layout

	return row.x + api.plain(row.y).slice(row.x).trimEnd().length
}

const PEAK_STYLE = `${fg(PEAK_INK)}${BOLD}${bg(SHADE.head)}`
const NOTES: NonNullable<ThemeModule['notes']> = {
	a: 'notice, progress, new lane, progress — every effect in turn',
	i: 'code rain in the panel · a drop falls down the board each second · TRACE ■----',
	p: 'the typed line glows, its head white · a light rain falls · the panel rain quickens while it types',
	r: 'the new lane decodes out of dark rain · the rain pours over the whole board, then clears',
	n: 'the notice locks out of spinning glyphs · a wall of rain washes THROUGHPUT and USAGE away · deja vu · TRACE 1 · flash waves',
}

// A frame's layers, in the demo's order.
const LAYERS: ReadonlyArray<(view: TraceView) => void> = [
	lay_clocks,
	(view) => {
		notice_trace(view.grid, view.s, SHADE.bright)
	},
	(view) => {
		dark_dashes(view.grid)
	},
	draw_seconds,
	wash_area,
	draw_pour,
	draw_idle,
	type_glow,
	decode,
	change_flash,
	clock_flash,
	notice_lock,
	deja_vu,
	trace_gauge,
	(view) => {
		peak_flash(view.grid, view.s, PEAK_STYLE)
	},
]

function draw(view: TraceView): void {
	for (const layer of LAYERS) layer(view)
}

// What the theme reads off the board once.
function board_of(api: ThemeApi): TraceBoard {
	return { api, layout: api.layout, row_last: row_last(api), clock_fields: clock_fields(api) }
}

function theme(api: ThemeApi): ThemeModule {
	const board = board_of(api)
	// The rows the code rain has fallen by each of its frames, built once for the theme.
	const fallen = run_board_theme_trace_pass.fallen_of()

	return {
		name: 'MATRIX',
		colons: true,
		notes: NOTES,
		colors: COLORS,
		draw: (grid, state, tick) => {
			draw({ ...board, grid, s: state, tick })
		},
		opening: opening_of(api, fallen),
		ending: ending_of(api, fallen),
	}
}

const run_board_theme_trace = { board_of, theme }

export { run_board_theme_trace }
