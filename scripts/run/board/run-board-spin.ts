import { poll } from '#scripts/lib/poll'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { run_board_fit, type TerminalSize } from './run-board-fit'
import { run_board_intro } from './run-board-intro'
import { run_board_labels } from './run-board-labels'
import { run_board_lamp_spots, type Lamp } from './run-board-lamp-spots'
import { run_board_row_key } from './run-board-row-key'
import { run_board_screen } from './run-board-screen'
import { run_board_spot, type Spot } from './run-board-spot'
import type { BoardPorts } from './run-board-state'
import { run_board_sweep, type Sweep } from './run-board-sweep'
import { run_board_timing } from './run-board-timing'
import { run_board_type_rows, type KeyedLine, type Typing } from './run-board-type-rows'

// The spinners of a live `run:board` frame turned between redraws. The frame
// is redrawn once a second, on the second, and between redraws only the spinners' own cells are written
// at the package's interval: a cursor move and one character each, with no read, layout or render. The
// renderer draws a placeholder where a spinner goes, and each placeholder's place on screen — its row
// after the lines above it wrap, its column by display width — is recorded as the frame is written. A
// row the frame was cut to the terminal's rows without is not on screen, so it records nothing. The
// sweep under the third line's age (`run-board-sweep.ts`) is placed the same way, by its own placeholder.

const { SPOT, TICK, spot_at } = run_board_spot
const { SWEEP_MS, sweep_bytes, sweep_index } = run_board_sweep
const REDRAW_MS = MS_PER_SECOND
const CSI = '\u{1B}['
const RESET = `${CSI}0m`
const { SPINNER_INTERVAL_MS, spinner_of } = run_board_labels
const { LETTER_MS } = run_board_intro

// The frame's lines as written, its spinners' spots, its keyed rows on screen, without their keys, the
// sweep where the frame has room for one and its lamps (`run-board-lamp-spots.ts`).
interface Spun {
	lines: Array<string>
	spots: Array<Spot>
	keyed: Array<KeyedLine>
	sweep: Sweep | undefined
	lamps: Array<Lamp>
}

// What is written between redraws: the spinners turned, the sweep moved, the lamps blinked and the rows
// typing.
interface Turning {
	spots: ReadonlyArray<Spot>
	typing: Typing
	sweep?: Sweep | undefined
	lamps?: ReadonlyArray<Lamp> | undefined
}

// What changed since the last turn was written: the spinner's frame, the sweep's cell, and the moment
// the lamps were last written at — none to write every lamp.
interface Turned {
	is_turned: boolean
	is_swept: boolean
	since_ms: number | undefined
}

// The spinner's frame and the sweep's cell at a moment, compared turn to turn.
interface Moment {
	frame: string
	cell: number
	ms: number
}

type SpinPorts = Pick<
	BoardPorts,
	'now' | 'sleep' | 'write' | 'write_drawn' | 'time_draw' | 'typing_sound'
>

function line_spots(line: string, row: number, columns: number): Array<Spot> {
	return [...line.matchAll(new RegExp(SPOT, 'gu'))].map((match) =>
		spot_at(line, match.index, row, columns),
	)
}

// The row on screen each line starts on, after the lines above it wrap.
function starts_of(lines: ReadonlyArray<string>, columns: number): Array<number> {
	let row = 1

	return lines.map((line) => {
		const start = row

		row += run_board_fit.height_of(line, columns)

		return start
	})
}

// Each line with its placeholders drawn as `frame` and its key taken out, and the keyed ones — their
// placeholders kept, so a typing row draws the spinner's frame of the moment it is written.
function keyed_of(
	lines: ReadonlyArray<string>,
	frame: string,
	starts: ReadonlyArray<number>,
): Pick<Spun, 'lines' | 'keyed'> {
	const split = lines.map((line) => run_board_row_key.split_key(line))
	const keyed = split.flatMap(({ key, text, prefix }, index) =>
		key === undefined
			? []
			: {
					key,
					index,
					row: starts[index] ?? 1,
					text,
					prefix_columns: run_board_fit.width_of(prefix),
				},
	)

	return { lines: split.map((line) => run_board_spot.drawn(line.text, frame)), keyed }
}

// A keyed row types only on screen and within one screen row: a row typed shorter than it wraps would
// take fewer rows and move every line below it off the spots recorded for them.
function can_type(line: KeyedLine, rows: number, columns: number): boolean {
	return line.row <= rows && run_board_fit.height_of(line.text, columns) === 1
}

// The sweep under the line the `″` placeholder is drawn in, where the line below it has room for one.
function sweep_in(
	lines: ReadonlyArray<string>,
	starts: ReadonlyArray<number>,
	size: { rows: number; columns: number },
): Sweep | undefined {
	const index = lines.findIndex((line) => line.includes(TICK))
	const line = lines[index]

	if (line === undefined) return undefined
	const { column } = spot_at(line, line.indexOf(TICK), starts[index] ?? 1, size.columns)
	const row_below = starts[index + 1] ?? Infinity

	return run_board_sweep.sweep_of({ row_below, column, line_below: lines[index + 1] }, size)
}

// The frame with each placeholder drawn as `frame` and each key taken out, every placeholder's spot on
// screen, the keyed rows that can type and the sweep.
function spun(lines: ReadonlyArray<string>, frame: string, size?: TerminalSize): Spun {
	const columns = Math.max(1, size?.columns ?? Infinity)
	const rows = size?.rows ?? Infinity
	const starts = starts_of(lines, columns)
	const spots = lines.flatMap((line, index) => line_spots(line, starts[index] ?? 1, columns))
	const drawn = keyed_of(lines, frame, starts)

	return {
		lines: drawn.lines,
		spots: spots.filter((spot) => spot.row <= rows),
		keyed: drawn.keyed.filter((line) => can_type(line, rows, columns)),
		sweep: sweep_in(lines, starts, { rows, columns }),
		lamps: run_board_lamp_spots.lamps_in(lines, starts, columns).filter((lamp) => lamp.row <= rows),
	}
}

// One spinner frame at every spot: the cursor moved there, the spot's colors, the frame, then a reset.
function spin_bytes(spots: ReadonlyArray<Spot>, frame: string): string {
	return spots
		.map((spot) => `${CSI}${String(spot.row)};${String(spot.column)}H${spot.style}${frame}${RESET}`)
		.join('')
}

// The first multiple of `interval_ms` after `now_ms`.
function boundary_after(now_ms: number, interval_ms: number): number {
	return now_ms - (now_ms % interval_ms) + interval_ms
}

// The next moment the spinner turns, the sweep moves or, while a row types, its next letter is due —
// whichever comes first, so none paces the others — but never past `until_ms`.
function next_turn(now_ms: number, until_ms: number, turning: Turning): number {
	const turn_ms = boundary_after(now_ms, SPINNER_INTERVAL_MS)
	const letter_ms = turning.typing.lines.length > 0 ? boundary_after(now_ms, LETTER_MS) : Infinity
	const sweep_ms = turning.sweep === undefined ? Infinity : boundary_after(now_ms, SWEEP_MS)

	return Math.min(turn_ms, letter_ms, sweep_ms, until_ms)
}

// The spinners turned when their frame changed, the sweep when its cell did, then the rows typing
// written over them, in one synchronized write (joshuafolkken/kit#8125).
function turn_bytes(turning: Turning, at_ms: number, turned: Turned): string {
	const spin = turned.is_turned ? spin_bytes(turning.spots, spinner_of(at_ms)) : ''
	const { sweep } = turning
	const swept = sweep !== undefined && turned.is_swept ? sweep_bytes(sweep, at_ms) : ''

	return run_board_screen.synced(
		`${spin}${swept}${run_board_type_rows.type_bytes(turning.typing, at_ms)}`,
	)
}

// The lamps blink once the first frame is out, the base the rows type against (joshuafolkken/kit#8236).
function blinking(turning: Turning): ReadonlyArray<Lamp> {
	return turning.typing.seen === undefined ? [] : (turning.lamps ?? [])
}

// The turn built and written, timed as a turn where `--timing` times draws, then the lamps that changed;
// the trill sounds on while a row is still typing, off once every row is typed through
// (joshuafolkken/kit#8250).
function write_turn(turning: Turning, ports: SpinPorts, at_ms: number, turned: Turned): void {
	run_board_timing.drawn(ports, 'turn', () => {
		ports.write(turn_bytes(turning, at_ms, turned))
		run_board_lamp_spots.write_lamps(blinking(turning), ports, at_ms, turned.since_ms)
	})
	ports.typing_sound?.set(run_board_type_rows.is_typing(turning.typing, at_ms))
}

function moment_of(at_ms: number): Moment {
	return { frame: spinner_of(at_ms), cell: sweep_index(at_ms), ms: at_ms }
}

function turned_since(last: Moment, at: Moment): Turned {
	return { is_turned: at.frame !== last.frame, is_swept: at.cell !== last.cell, since_ms: last.ms }
}

// The sweep and every lamp written where the frame has them, so they show on the second before the first
// wake.
function start_sweep(turning: Turning, ports: SpinPorts): void {
	if (turning.sweep === undefined && blinking(turning).length === 0) return

	write_turn(turning, ports, ports.now(), { is_turned: false, is_swept: true, since_ms: undefined })
}

// joshuafolkken/kit#8123: a wake for a letter or the sweep between frame boundaries writes no spinner,
// so each frame is written once, on its boundary; the sweep is written likewise once per cell.
async function turn_until(turning: Turning, ports: SpinPorts, until_ms: number): Promise<void> {
	let last = moment_of(ports.now())

	start_sweep(turning, ports)
	await poll.poll_until(() => ports.now() >= until_ms, {
		attempts: Infinity,
		interval_ms: 0,
		sleeper: async () => {
			const now_ms = ports.now()

			await ports.sleep(next_turn(now_ms, until_ms, turning) - now_ms)
			const at_ms = ports.now()
			const at = moment_of(at_ms)

			if (at_ms < until_ms) write_turn(turning, ports, at_ms, turned_since(last, at))
			last = at
		},
	})
}

// A frame with no spinner, sweep, typing row or blinking lamp writes nothing between redraws.
function is_still(turning: Turning): boolean {
	const is_moving = turning.typing.lines.length > 0 || blinking(turning).length > 0

	return turning.spots.length === 0 && !is_moving && turning.sweep === undefined
}

// Waits for the next second, turning the spinners, moving the sweep and typing the rows until then; a
// still frame just waits.
async function spin_to_second(turning: Turning, ports: SpinPorts): Promise<void> {
	const now_ms = ports.now()
	const second_ms = now_ms - (now_ms % REDRAW_MS) + REDRAW_MS

	if (is_still(turning)) {
		await ports.sleep(second_ms - now_ms)

		return
	}

	await turn_until(turning, ports, second_ms)
}

const run_board_spin = { REDRAW_MS, SPOT, spin_bytes, spin_to_second, spun }

export { run_board_spin }
export type { Spun, Turning }

export { type Spot } from './run-board-spot'
