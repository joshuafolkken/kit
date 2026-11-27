import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import type { TerminalSize } from './run-board-fit'
import { run_board_frame_loop, type FrameScreen } from './run-board-frame-loop'
import { run_board_lamp_spots, type Lamp } from './run-board-lamp-spots'
import { run_board_layer, type Layer } from './run-board-layer'
import { run_board_layer_spin } from './run-board-layer-spin'
import { run_board_repaint } from './run-board-repaint'
import { run_board_spin_place } from './run-board-spin-place'
import { run_board_spin_turn, type SpinPorts, type Turning } from './run-board-spin-turn'
import { run_board_spot, type Spot } from './run-board-spot'
import { run_board_theme_events } from './run-board-theme-events'
import { run_board_theme_layer } from './run-board-theme-layer'
import type { LayoutView } from './run-board-theme-layout'
import { run_board_theme_notice_sound } from './run-board-theme-notice-sound'
import { run_board_theme_run, type ThemeRun } from './run-board-theme-run'
import { run_board_type_rows, type KeyedLine } from './run-board-type-rows'

// The spinners of a live `run:board` frame turned between redraws. The frame is redrawn once a second,
// on the second, and between redraws only the spinners' own cells change: the renderer draws a
// placeholder where a spinner goes, and each placeholder's place on screen — its row after the lines
// above it wrap, its column by display width — is recorded as the frame is written. A row the frame was
// cut to the terminal's rows without is not on screen, so it records nothing. A themed board's second is
// drawn by its theme layer instead (joshuafolkken/kit#8917), laid out by the lamp panel's lamps and the
// keyed rows recorded here. What one wake writes is the frame loop's (`run-board-frame-loop.ts`).

const { COLON, SPOT } = run_board_spot
const { can_type, keyed_of, marks_in, starts_of } = run_board_spin_place
const { colons_of } = run_board_spin_turn
const REDRAW_MS = MS_PER_SECOND

// The frame's lines as written, its spinners' spots, its keyed rows on screen, without their keys, and
// its lamps (`run-board-lamp-spots.ts`).
interface Spun {
	lines: Array<string>
	spots: Array<Spot>
	keyed: Array<KeyedLine>
	lamps: Array<Lamp>
}

// The terminal a frame is spun for; none, an unbounded screen.
interface SpinView {
	size?: TerminalSize | undefined
}

// The screen's rows and columns, at least one column; none unbounded.
function screen_of(size: TerminalSize | undefined): TerminalSize {
	return { columns: Math.max(1, size?.columns ?? Infinity), rows: size?.rows ?? Infinity }
}

// The cells within the terminal's `rows`; a row the frame was cut without is not on screen.
function on_screen<Cell extends { row: number }>(
	cells: ReadonlyArray<Cell>,
	rows: number,
): Array<Cell> {
	return cells.filter((cell) => cell.row <= rows)
}

// The frame with each placeholder drawn as `frame` and each key taken out, every placeholder's spot on
// screen, the keyed rows that can type and the lamps. No `size` spins an unbounded screen.
function spun(lines: ReadonlyArray<string>, frame: string, { size }: SpinView = {}): Spun {
	const { columns, rows } = screen_of(size)
	const starts = starts_of(lines, columns)
	const drawn = keyed_of(lines, frame, starts)

	return {
		lines: drawn.lines,
		spots: marks_in(lines, SPOT, starts, { rows, columns }),
		keyed: drawn.keyed.filter((line) => can_type(line, rows, columns)),
		lamps: on_screen(run_board_lamp_spots.lamps_in(lines, starts, columns), rows),
	}
}

// The header clocks' colon placeholders' spots in `lines` — the frame as the theme draws it, so each
// spot's style carries the color its colon is darkened from (`run-board-colon.ts`).
function colons_in(lines: ReadonlyArray<string>, size?: TerminalSize): Array<Spot> {
	const columns = Math.max(1, size?.columns ?? Infinity)
	const bounds = { rows: size?.rows ?? Infinity, columns }

	return marks_in(lines, COLON, starts_of(lines, columns), bounds)
}

// A frame with no spinner, typing row or clock colon writes nothing between redraws; the colons, drawn
// lit with the frame, need no write before their first half second.
function is_still(turning: Turning): boolean {
	const is_bare = turning.spots.length === 0 && colons_of(turning).length === 0

	return is_bare && turning.typing.lines.length === 0
}

// joshuafolkken/kit#8917: the theme run that draws this second — a theme chosen, on the themed ports
// (the plain ones, `run-board-live.ts` plain_of, carry the run but no theme); none otherwise. A frame
// with no lamp panel on screen (a folded section, a short pane) keeps its theme, which then draws no area
// parts (`run-board-theme-layout.ts`).
function themed_run(ports: SpinPorts): ThemeRun | undefined {
	const run = ports.theme_run

	if (run === undefined || ports.theme === undefined) return undefined

	return run_board_theme_run.is_drawn(run) ? run : undefined
}

// What the theme layer lays a themed second out by (`run-board-theme-layout.ts`).
function view_of(turning: Turning, run: ThemeRun): LayoutView {
	return {
		lamps: turning.lamps ?? [],
		keyed: turning.keyed ?? [],
		colons: colons_of(turning),
		spots: turning.spots,
		row_key: run_board_theme_events.row_key_of(run.events),
		dated_clocks: turning.dated_clocks,
	}
}

// joshuafolkken/kit#9087: how far a themed board draws behind its sounds — the output's delay.
function delay_of(ports: SpinPorts): () => number {
	return () => ports.typing_sound?.delay_ms?.() ?? 0
}

// The frame's layers in the order they are drawn, the redraw at the bottom: in no theme the spinners,
// restyled by the theme's restyle; a themed second the theme layer alone over the redraw — it types,
// turns the spinners and blinks the colons itself.
function layers_of(turning: Turning, ports: SpinPorts, screen: FrameScreen): Array<Layer> {
	const base = run_board_frame_loop.base_layer(screen)
	const run = themed_run(ports)

	if (run !== undefined) {
		return [base, run_board_theme_layer.theme_layer(run, view_of(turning, run), delay_of(ports))]
	}

	return [base, run_board_layer_spin.spin_layer(turning, ports.restyle ?? String)]
}

// The theme run told of this second: the board's level, the events its newly typing rows start, and an
// opening that cannot play ended.
function observed(turning: Turning, ports: SpinPorts): void {
	const run = ports.theme_run

	if (run === undefined) return
	run.level = turning.alert_level
	// The rows' words as the board draws them — the theme's marks for the board's emoji — so the theme
	// types what the base shows (joshuafolkken/kit#8917).
	const restyle = ports.restyle ?? String
	const lines = turning.typing.lines.map((line) => ({ ...line, text: restyle(line.text) }))

	run_board_theme_run.observe(run, lines, ports.now())
	run_board_theme_run.settle(run, themed_run(ports) !== undefined)
}

// The trill while a row is still typing, off once every row is typed through (joshuafolkken/kit#8250);
// on a themed board, with its opening's sound (`run-board-theme-sound.ts`).
function sounded(turning: Turning, ports: SpinPorts, at_ms: number): void {
	const { typing } = turning
	const board = {
		is_on: run_board_type_rows.is_typing(typing, at_ms),
		left_ms: run_board_type_rows.left_ms(typing, at_ms),
	}

	if (ports.theme_run === undefined) ports.typing_sound?.set(board.is_on, board.left_ms)
	else run_board_theme_layer.after_frame(ports.theme_run, ports.typing_sound, at_ms, board)
}

// The sounds a themed frame may start rendered ahead, before it is written (joshuafolkken/kit#9087); a
// part the frame begins then begins as the rendering is over, not before it.
function warmed(ports: SpinPorts, at_ms: number): void {
	const run = themed_run(ports)

	if (run === undefined) return
	run_board_theme_notice_sound.warm_events(run, ports.typing_sound, at_ms)
	run_board_theme_layer.rebased(run, at_ms, ports.now())
}

// Draws the redraw on `screen`, then turns the spinners — or draws the theme — until the next second;
// a still frame just waits — one the theme draws never is; a theme run showing none (a board launched
// in no theme, Issue 4-4) is still as a board without one.
async function spin_to_second(
	turning: Turning,
	ports: SpinPorts,
	screen: FrameScreen,
): Promise<void> {
	observed(turning, ports)

	await run_board_frame_loop.run(
		{
			layers: layers_of(turning, ports, screen),
			until_ms: run_board_layer.boundary_after(ports.now(), REDRAW_MS),
			is_still: themed_run(ports) === undefined && is_still(turning),
			before_write: (at_ms) => {
				warmed(ports, at_ms)
			},
			after_frame: (at_ms) => {
				sounded(turning, ports, at_ms)
			},
			// joshuafolkken/kit#8917, #8939: a redraw asked for — a switch in demo mode, a fold, the sound
			// switch — ends this second, so the next redraw draws the new screen before its first frame; the
			// old base (the green lamp panel a themed board is laid out on) never shows under it.
			is_current: run_board_repaint.current_of(ports.repaint),
		},
		ports,
		screen,
	)
}

const run_board_spin = {
	REDRAW_MS,
	SPOT,
	colons_in,
	spin_to_second,
	spun,
	starts_of,
}

export { run_board_spin }
export type { Spun }

export { type Spot } from './run-board-spot'

export { type Turning } from './run-board-spin-turn'
