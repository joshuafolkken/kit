import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { run_board_change_flash } from './run-board-change-flash'
import { run_board_codes, type RuleCell } from './run-board-codes'
import type { TerminalSize } from './run-board-fit'
import { run_board_frame_loop, type FrameScreen } from './run-board-frame-loop'
import { run_board_lamp_spots, type Lamp } from './run-board-lamp-spots'
import { run_board_layer, type Layer } from './run-board-layer'
import { run_board_layer_effects } from './run-board-layer-effects'
import { run_board_layer_spin } from './run-board-layer-spin'
import { run_board_notice_turn } from './run-board-notice-turn'
import {
	run_board_panel_draw as panel_draw,
	type PanelArea,
	type PanelMoment,
} from './run-board-panel-draw'
import { run_board_spin_place } from './run-board-spin-place'
import { run_board_spin_turn, type SpinPorts, type Turning } from './run-board-spin-turn'
import { run_board_spot, type Spot } from './run-board-spot'
import { run_board_strip, type StripCell } from './run-board-strip'
import type { Sweep } from './run-board-sweep'
import { run_board_trace_spot } from './run-board-trace-spot'
import { run_board_type_rows, type KeyedLine } from './run-board-type-rows'

// The spinners of a live `run:board` frame turned between redraws. The frame
// is redrawn once a second, on the second, and between redraws only the spinners' own cells are written
// at the package's interval: a cursor move and one character each, with no read, layout or render. The
// renderer draws a placeholder where a spinner goes, and each placeholder's place on screen — its row
// after the lines above it wrap, its column by display width — is recorded as the frame is written. A
// row the frame was cut to the terminal's rows without is not on screen, so it records nothing. The
// sweep under the third line's age (`run-board-sweep.ts`) is placed the same way, by its own placeholder.
// What one wake writes is `run-board-spin-turn.ts`'s.

const { COLON, SPOT } = run_board_spot
const { can_type, keyed_of, marks_in, starts_of, sweep_in } = run_board_spin_place
const { blinking, colons_of, traces_of } = run_board_spin_turn
const REDRAW_MS = MS_PER_SECOND

// The frame's lines as written, its spinners' spots, its keyed rows on screen, without their keys, the
// sweep where the frame has room for one and its lamps (`run-board-lamp-spots.ts`).
interface Spun {
	lines: Array<string>
	spots: Array<Spot>
	keyed: Array<KeyedLine>
	sweep: Sweep | undefined
	lamps: Array<Lamp>
	area: PanelArea | undefined
	traces: Array<Spot>
	rules: Array<RuleCell>
	strips: Array<StripCell>
}

// The terminal a frame is spun for and the idle rain's moment its lamps are drawn at; none, an unbounded
// screen and no rain.
interface SpinView {
	size?: TerminalSize | undefined
	rain?: PanelMoment | undefined
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
// screen, the keyed rows that can type and the sweep; a rain frame's lamps drawn as the idle rain's cells
// at `rain` (joshuafolkken/kit#8647). No `size` spins an unbounded screen.
function spun(lines: ReadonlyArray<string>, frame: string, { size, rain }: SpinView = {}): Spun {
	const { columns, rows } = screen_of(size)
	const starts = starts_of(lines, columns)
	const found = run_board_lamp_spots.lamps_in(lines, starts, columns)
	const drawn = keyed_of(run_board_lamp_spots.rained(lines, found, rain), frame, starts)
	const lamps = on_screen(found, rows)
	const rules = on_screen(run_board_codes.rule_cells(lines, starts, columns), rows)

	return {
		lines: drawn.lines,
		spots: marks_in(lines, SPOT, starts, { rows, columns }),
		keyed: drawn.keyed.filter((line) => can_type(line, rows, columns)),
		sweep: sweep_in(lines, starts, { rows, columns }),
		lamps,
		area: panel_draw.area_of(lines, starts, lamps),
		traces: on_screen(run_board_trace_spot.traces_in(lines, starts, columns), rows),
		rules,
		strips: run_board_strip.strip_cells(lines, starts, { lamps, rules }),
	}
}

// The header clocks' colon placeholders' spots in `lines` — the frame as the theme draws it, so each
// spot's style carries the color its colon is darkened from (`run-board-colon.ts`).
function colons_in(lines: ReadonlyArray<string>, size?: TerminalSize): Array<Spot> {
	const columns = Math.max(1, size?.columns ?? Infinity)
	const bounds = { rows: size?.rows ?? Infinity, columns }

	return marks_in(lines, COLON, starts_of(lines, columns), bounds)
}

function is_falling(turning: Turning): boolean {
	return turning.sweep !== undefined || turning.drop !== undefined
}

function has_effects(turning: Turning): boolean {
	const is_moving = is_falling(turning) || turning.jump !== undefined
	const is_blinking = blinking(turning).length > 0 || traces_of(turning).length > 0

	return is_moving || is_blinking || run_board_notice_turn.is_placed(turning.notice_trace)
}

// A frame with no spinner, sweep, typing row, blinking lamp, flashing cell or clock colon writes
// nothing between redraws; the colons, drawn lit with the frame, need no write before their first
// half second.
function is_still(turning: Turning): boolean {
	const is_bare = turning.spots.length === 0 && colons_of(turning).length === 0
	// The flash is written over the frame with it, so it needs no write before its first turn.
	const is_dark = !has_effects(turning) && !run_board_change_flash.is_lit(turning.flash)

	return is_bare && turning.typing.lines.length === 0 && is_dark
}

// The frame's layers in the order they are drawn, the redraw at the bottom; the spinners and the rows
// typing restyled by the theme, the rest drawn past it.
function layers_of(turning: Turning, ports: SpinPorts, screen: FrameScreen): Array<Layer> {
	const restyle = ports.restyle ?? String

	return [
		run_board_frame_loop.base_layer(screen),
		...run_board_layer_effects.under(turning),
		run_board_layer_spin.spin_layer(turning, restyle),
		run_board_layer_spin.typing_layer(turning, restyle),
		...run_board_layer_effects.over(turning),
	]
}

// Draws the redraw on `screen`, then turns the spinners, moves the sweep and types the rows until the
// next second; a still frame just waits. The trill sounds while a row is still typing, off once every
// row is typed through (joshuafolkken/kit#8250).
async function spin_to_second(
	turning: Turning,
	ports: SpinPorts,
	screen: FrameScreen,
): Promise<void> {
	const { typing } = turning

	await run_board_frame_loop.run(
		{
			layers: layers_of(turning, ports, screen),
			until_ms: run_board_layer.boundary_after(ports.now(), REDRAW_MS),
			is_still: is_still(turning),
			after_frame: (at_ms) =>
				ports.typing_sound?.set(
					run_board_type_rows.is_typing(typing, at_ms),
					run_board_type_rows.left_ms(typing, at_ms),
				),
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
