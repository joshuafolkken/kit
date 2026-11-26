import { run_board_theme_host_flash } from './run-board-theme-host-flash'
import type { Grid, ThemeApi, ThemeModule, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_wopr_data } from './run-board-theme-wopr-data'
import { run_board_theme_wopr_idle } from './run-board-theme-wopr-idle'
import { run_board_theme_wopr_map } from './run-board-theme-wopr-map'
import { run_board_theme_wopr_notice } from './run-board-theme-wopr-notice'
import { run_board_theme_wopr_parts } from './run-board-theme-wopr-parts'
import { run_board_theme_wopr_phase } from './run-board-theme-wopr-phase'
import { run_board_theme_wopr_place, type Wopr } from './run-board-theme-wopr-place'
import { run_board_theme_wopr_row } from './run-board-theme-wopr-row'

// WARGAMES, the WOPR theme of `run:board` (board name josh-wopr), on the theme host
// (joshuafolkken/kit#8917), ported from the confirmed theme demo (`fixed-v21-theme-wargames.mjs`).
// IDLE, PROGRESS and the opening are a port of kit's live board in this theme. Beyond kit, in the
// film's vocabulary, the events centre on WOPR's LAUNCH panel over the THROUGHPUT and USAGE area:
// - PROGRESS: kit's effect, plus a three-letter strip beside DEFCON that locks `CPE` as the line types.
// - ROW: WOPR works the code as the lane types but never gets it; DEFCON 4, the lane cracks in, a scan
//   column crosses the screen, stray characters flicker as code.
// - NOTICE: the code locks and blinks until the peak; DEFCON 5 → 1 and the board reddens; the spark;
//   sixteen wars beside the WINNER table; then dark, the film's last three lines.
// The ending is the film's last exchange. Every drawing is a function of (state, tick).

const { notice_trace, start_flash } = run_board_theme_host_flash
const { COLORS, INK, RED } = run_board_theme_wopr_data
const { crack_row, draw_codes, draw_defcon, draw_lamps, draw_sweep, progress_strip } =
	run_board_theme_wopr_idle
const { screen_blobs } = run_board_theme_wopr_map
const { darken, flash, notice_event } = run_board_theme_wopr_notice
const { ending_of, opening_of } = run_board_theme_wopr_parts
const { is_notice, is_progress, is_row } = run_board_theme_wopr_phase
const { wopr_of } = run_board_theme_wopr_place
const { row_event, scan_over_codes } = run_board_theme_wopr_row

// NOTICE's whole length in ticks from its start (`lasts.n`): it peaks 79 ticks in and the effect is
// over EFFECT_END (238) ticks after the peak — 317 ticks, so a demo notice starting at tick 10 ends at
// tick 327, as the demo's 330-tick NOTICE does.
const NOTICE_LASTS = run_board_theme_wopr_phase.NOTICE_TICKS

const NOTES = {
	a: 'notice, progress, new lane, progress — every effect in turn',
	i: 'the WOPR lamps blink (80 ms steps, groups of 4) · the sweep crosses under the clock each second · DEFCON [5]',
	p: 'the now line types 50 ms a letter · the lamps burst · the rules run launch code · CPE locks letter by letter beside DEFCON',
	r: 'DEFCON 4 · LAUNCH: WOPR locks CPE 1704 TKS out of order, 8 of 10, never gets it · beside it tic-tac-toe, draw after draw · the lane cracks in · a scan column',
	n: 'DEFCON 5→1 · CPE 1704 TKS locks in 2.5 s, blinks to the peak, tic-tac-toe draws ever faster beside it · then left: sixteen wars, ever faster, white blobs merge to white-out · right: STRATEGY / WINNER pages, ever faster · dark: A STRANGE GAME., 3 s hold',
}

// The NOTICE's whole-screen layers over everything drawn.
function notice_layers(wopr: Wopr, grid: Grid, state: ThemeState, tick: number): void {
	screen_blobs(wopr, grid, state)
	darken(grid, state)
	notice_trace(grid, state, RED)
	start_flash(grid, state, tick, INK.red_on)
	flash(wopr, grid, state)
}

// The event drawn this tick, NOTICE over ROW, or undefined (the lamps blink instead).
function event_drawn(
	wopr: Wopr,
	grid: Grid,
	state: ThemeState,
	tick: number,
): 'n' | 'r' | undefined {
	if (notice_event(wopr, grid, state, tick)) return 'n'
	if (row_event(wopr, grid, state, tick)) return 'r'

	return undefined
}

function draw(wopr: Wopr, grid: Grid, state: ThemeState, tick: number): void {
	crack_row(wopr, grid, state, tick)
	draw_sweep(wopr, grid, tick)
	const event = event_drawn(wopr, grid, state, tick)

	if (event === undefined) draw_lamps(wopr, grid, state, tick)
	draw_codes(wopr, grid, state, tick)
	if (event === 'r') scan_over_codes(wopr, grid, state, tick)
	draw_defcon(wopr, grid, state, tick)
	progress_strip(wopr, grid, state, tick)
	if (is_notice(state)) notice_layers(wopr, grid, state, tick)
}

function theme(api: ThemeApi): ThemeModule {
	const wopr = wopr_of(api)

	return {
		name: 'WARGAMES',
		board: 'josh-wopr',
		capitals: true,
		colons: true,
		notes: NOTES,
		colors: COLORS,
		lasts: { n: NOTICE_LASTS },
		draw: (grid, state, tick) => {
			draw(wopr, grid, state, tick)
		},
		// The phases the drawings read (`run-board-theme-wopr-phase.ts`).
		playing: (state) => is_notice(state) || is_row(state) || is_progress(state),
		opening: opening_of(wopr),
		ending: ending_of(wopr),
	}
}

const run_board_theme_wopr = { NOTICE_LASTS, theme }

export { run_board_theme_wopr }
