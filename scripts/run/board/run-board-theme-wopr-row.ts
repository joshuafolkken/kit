import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Grid, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'
import { run_board_theme_wopr_led } from './run-board-theme-wopr-led'
import { run_board_theme_wopr_panel } from './run-board-theme-wopr-panel'
import { run_board_theme_wopr_phase } from './run-board-theme-wopr-phase'
import type { Wopr } from './run-board-theme-wopr-place'

// The WARGAMES theme's ROW (joshuafolkken/kit#8917), ported from the confirmed theme demo: WOPR works
// the code as the lane types and misses, plays tic-tac-toe beside it, and a scan column crosses.

const { cell_at, restyle, set_cell } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { INK } = run_board_theme_wopr_data
const { matched, row_look } = run_board_theme_wopr_led
const { game_at, panel } = run_board_theme_wopr_panel
const { code_char, count, is_row } = run_board_theme_wopr_phase

// A scan column crosses the whole screen every 24 ticks: three cells wide in white, a white wake for
// six columns, starting six columns off the left edge.
const SCAN = { ticks: 24, lead: 6, wake: 9 }
// Stray characters flicker as code for a tick: four at a time in ROW.
const STRAYS = 4
const SALT = { y: 31, x: 32 }
// Beside the code, WOPR plays tic-tac-toe at a steady move every 4 ticks.
const ROW_MOVE_TICKS = 4

// The scan column's head at `tick`.
function scan_x(wopr: Wopr, state: ThemeState, tick: number): number {
	const { w } = wopr.api.layout
	const age = tick - state.row.start

	return Math.floor(((age % SCAN.ticks) * (w + SCAN.lead + SCAN.lead)) / SCAN.ticks) - SCAN.lead
}

// Lights what is drawn under the scan column on the rows `is_lit_row` picks, never blanks.
function light(grid: Grid, x: number, is_lit_row: (y: number) => boolean): void {
	restyle(
		grid,
		([ch], cx, y) => ch !== ' ' && cx > x - SCAN.wake && cx <= x + 1 && is_lit_row(y),
		(cx) => (cx >= x - 1 ? INK.white_on : INK.scan_wake),
	)
}

// The demo's scan: keeps off the notice and the progress line.
function scan(wopr: Wopr, grid: Grid, state: ThemeState, tick: number): void {
	const { notice, progress } = wopr.api.layout

	light(grid, scan_x(wopr, state, tick), (y) => !(y === notice.y || y === progress.y))
}

// A kit-only touch over the demo (joshuafolkken/kit#8917): after the rules turn to code, the scan
// lights them too, and the header's notice and progress lines; their letters stay, only their color.
function scan_over_codes(wopr: Wopr, grid: Grid, state: ThemeState, tick: number): void {
	const { notice, progress } = wopr.api.layout
	const rows = new Set([notice.y, progress.y, ...wopr.rule_cells.map((cell) => cell.y)])

	light(grid, scan_x(wopr, state, tick), (y) => rows.has(y))
}

interface Flock {
	strays: number
	from_y: number
	ink: string
}

// Stray characters across the board from row `from_y` flicker as code for a tick.
function flicker(wopr: Wopr, grid: Grid, tick: number, flock: Flock): void {
	const { h, w, edge, row } = wopr.api.layout
	const { from_y } = flock

	for (let k = 0; k < flock.strays; k++) {
		const y = from_y + Math.floor(hash(tick, k, SALT.y) * (h - from_y))
		const x = Math.floor(hash(tick, k, SALT.x) * Math.min(w, edge))

		if (cell_at(grid, y, x)[0] !== ' ' && y !== row.y) {
			set_cell(grid, { y, x }, [code_char(x, y, tick), flock.ink])
		}
	}
}

// ROW: the LAUNCH panel SEARCHING, the scan, four strays below the area.
function row_event(wopr: Wopr, grid: Grid, state: ThemeState, tick: number): boolean {
	if (!is_row(state)) return false
	const look = row_look(state, tick)
	const play = game_at(tick - state.row.start, () => ROW_MOVE_TICKS)
	const status = `SEARCHING · ${count(matched(look))}/10`

	panel(wopr, grid, { status, status_ink: INK.orange_on, look, play })
	scan(wopr, grid, state, tick)
	flicker(wopr, grid, tick, { strays: STRAYS, from_y: wopr.bottom + 1, ink: INK.white_on })

	return true
}

const run_board_theme_wopr_row = { flicker, row_event, scan, scan_over_codes }

export { run_board_theme_wopr_row }
export type { Flock }
