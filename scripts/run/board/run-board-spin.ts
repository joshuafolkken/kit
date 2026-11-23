import { poll } from '#scripts/lib/poll'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { run_board_change_flash } from './run-board-change-flash'
import { run_board_codes, type RuleCell } from './run-board-codes'
import { run_board_colon } from './run-board-colon'
import type { TerminalSize } from './run-board-fit'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_jump_screen } from './run-board-jump-screen'
import { run_board_labels } from './run-board-labels'
import { run_board_lamp_spots, type Lamp } from './run-board-lamp-spots'
import { run_board_notice_turn } from './run-board-notice-turn'
import {
	run_board_panel_draw as panel_draw,
	type PanelArea,
	type PanelMoment,
} from './run-board-panel-draw'
import { run_board_spin_place } from './run-board-spin-place'
import {
	run_board_spin_turn,
	type SpinPorts,
	type Turned,
	type Turning,
} from './run-board-spin-turn'
import { run_board_spot, type Spot } from './run-board-spot'
import { run_board_strip, type StripCell } from './run-board-strip'
import { run_board_sweep, type Sweep } from './run-board-sweep'
import { run_board_theme_defs } from './run-board-theme-defs'
import { run_board_trace_spot } from './run-board-trace-spot'
import type { KeyedLine } from './run-board-type-rows'

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
const { SWEEP_MS, sweep_index } = run_board_sweep
const { blinking, coded, colons_of, lamp_moment, painting, traces_of, write_turn } =
	run_board_spin_turn
const REDRAW_MS = MS_PER_SECOND
const { SPINNER_INTERVAL_MS, spinner_of } = run_board_labels
// joshuafolkken/kit#8349: the rows type at the wargames intro's pace; joshuafolkken/kit#8360 picks it
// per theme.
const LETTER_MS = run_board_theme_defs.THEME_DEFS.wargames.intro.letter_ms

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

// The spinner's frame, the sweep's cell, whether the colons are lit and the lamps' moment, compared turn
// to turn.
interface Moment {
	frame: string
	cell: number
	is_lit: boolean
	lamps: PanelMoment
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

// The first multiple of `interval_ms` after `now_ms`.
function boundary_after(now_ms: number, interval_ms: number): number {
	return now_ms - (now_ms % interval_ms) + interval_ms
}

function is_falling(turning: Turning): boolean {
	return turning.sweep !== undefined || turning.drop !== undefined
}

function has_effects(turning: Turning): boolean {
	const is_moving = is_falling(turning) || turning.jump !== undefined
	const is_blinking = blinking(turning).length > 0 || traces_of(turning).length > 0

	return is_moving || is_blinking || run_board_notice_turn.is_placed(turning.notice_trace)
}

// The next step the sweep moves, the drops fall or the jump's frame changes on.
function sweep_boundary(turning: Turning, now_ms: number): number {
	const sweep_ms = is_falling(turning) ? boundary_after(now_ms, SWEEP_MS) : Infinity
	const { FRAME_MS } = run_board_jump_screen
	const jump_ms = turning.jump === undefined ? Infinity : boundary_after(now_ms, FRAME_MS)

	return Math.min(sweep_ms, jump_ms)
}

// The next step the TRACE field blinks, the colons turn, the notice's trace changes or a flashing
// cell's color steps on.
function blink_boundary(turning: Turning, now_ms: number): number {
	const trace_ms =
		traces_of(turning).length > 0 ? run_board_header_trace.boundary_after(now_ms) : Infinity
	const notice_ms = run_board_notice_turn.wake_after(turning.notice_trace, now_ms)
	const colon_ms = run_board_colon.colon_boundary(colons_of(turning), now_ms)
	const flash_ms = run_board_change_flash.wake_after(turning.flash, now_ms)

	return Math.min(trace_ms, notice_ms, colon_ms, flash_ms)
}

// The next moment the spinner turns, the sweep moves, the rules' code steps or, while a row types, its
// next letter is due — whichever comes first, so none paces the others — but never past `until_ms`.
function next_turn(now_ms: number, until_ms: number, turning: Turning): number {
	const turn_ms = boundary_after(now_ms, SPINNER_INTERVAL_MS)
	const letter_ms = turning.typing.lines.length > 0 ? boundary_after(now_ms, LETTER_MS) : Infinity
	const { typing, cells } = coded(turning)
	const is_coding = run_board_codes.is_coding(typing, cells, now_ms)
	const code_ms = is_coding ? boundary_after(now_ms, run_board_codes.CODE_MS) : Infinity
	const effect_ms = Math.min(sweep_boundary(turning, now_ms), blink_boundary(turning, now_ms))
	const panel_ms = panel_draw.tick_after(painting(turning), now_ms)

	return Math.min(turn_ms, letter_ms, code_ms, effect_ms, panel_ms, until_ms)
}

function moment_of(turning: Turning, at_ms: number): Moment {
	return {
		frame: spinner_of(at_ms),
		cell: sweep_index(at_ms),
		is_lit: run_board_colon.is_lit(at_ms),
		lamps: lamp_moment(turning, at_ms),
	}
}

function turned_since(last: Moment, at: Moment): Turned {
	return {
		is_turned: at.frame !== last.frame,
		is_swept: at.cell !== last.cell,
		is_blinked: at.is_lit !== last.is_lit,
		since: last.lamps,
	}
}

// The sweep and every lamp written where the frame has them, so they show on the second before the first
// wake.
function start_sweep(turning: Turning, ports: SpinPorts): void {
	if (!has_effects(turning)) return

	write_turn(turning, ports, ports.now(), { is_turned: false, is_swept: true, since: undefined })
}

// joshuafolkken/kit#8123: a wake for a letter or the sweep between frame boundaries writes no spinner,
// so each frame is written once, on its boundary; the sweep is written likewise once per cell. The
// frame drew its colons lit, so a frame finished past the half second darkens them on the first wake.
async function turn_until(turning: Turning, ports: SpinPorts, until_ms: number): Promise<void> {
	let last = { ...moment_of(turning, ports.now()), is_lit: true }

	start_sweep(turning, ports)
	await poll.poll_until(() => ports.now() >= until_ms, {
		attempts: Infinity,
		interval_ms: 0,
		sleeper: async () => {
			const now_ms = ports.now()

			await ports.sleep(next_turn(now_ms, until_ms, turning) - now_ms)
			const at_ms = ports.now()
			const at = moment_of(turning, at_ms)

			if (at_ms < until_ms) write_turn(turning, ports, at_ms, turned_since(last, at))
			last = at
		},
	})
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

// Waits for the next second, turning the spinners, moving the sweep and typing the rows until then; a
// still frame just waits.
async function spin_to_second(turning: Turning, ports: SpinPorts): Promise<void> {
	const now_ms = ports.now()
	const second_ms = boundary_after(now_ms, REDRAW_MS)

	await (is_still(turning)
		? ports.sleep(second_ms - now_ms)
		: turn_until(turning, ports, second_ms))
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
