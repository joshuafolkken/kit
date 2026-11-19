import { poll } from '#scripts/lib/poll'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { run_board_fit, type TerminalSize } from './run-board-fit'
import { run_board_intro } from './run-board-intro'
import { run_board_labels } from './run-board-labels'
import { run_board_row_key } from './run-board-row-key'
import { run_board_spot } from './run-board-spot'
import type { BoardPorts } from './run-board-state'
import { run_board_type_rows, type KeyedLine, type Typing } from './run-board-type-rows'

// The spinners of a live `run:board` frame turned between redraws. The frame
// is redrawn once a second, on the second, and between redraws only the spinners' own cells are written
// at the package's interval: a cursor move and one character each, with no read, layout or render. The
// renderer draws a placeholder where a spinner goes, and each placeholder's place on screen — its row
// after the lines above it wrap, its column by display width — is recorded as the frame is written. A
// row the frame was cut to the terminal's rows without is not on screen, so it records nothing.

const { SPOT } = run_board_spot
const REDRAW_MS = MS_PER_SECOND
const CSI = '\u{1B}['
const RESET = `${CSI}0m`
// eslint-disable-next-line no-control-regex -- the color escapes a spot keeps are control characters
const SGR = /\u{1B}\[[\d;]*m/gu
const { SPINNER_INTERVAL_MS, spinner_of } = run_board_labels
const { LETTER_MS } = run_board_intro

// Where one spinner is on screen, 1-based, and the colors in effect where it is drawn.
interface Spot {
	row: number
	column: number
	style: string
}

// The frame's lines as written, its spinners' spots and its keyed rows on screen, without their keys.
interface Spun {
	lines: Array<string>
	spots: Array<Spot>
	keyed: Array<KeyedLine>
}

// What is written between redraws: the spinners turned and the rows typing.
interface Turning {
	spots: ReadonlyArray<Spot>
	typing: Typing
}

type SpinPorts = Pick<BoardPorts, 'now' | 'sleep' | 'write'>

// The spot of the placeholder at `index` in a line that starts `row` rows down the screen.
function spot_at(line: string, index: number, row: number, columns: number): Spot {
	const before = line.slice(0, index)
	const width = run_board_fit.width_of(before)
	const style = (before.match(SGR) ?? []).join('')

	return { row: row + Math.floor(width / columns), column: (width % columns) + 1, style }
}

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

// The frame with each placeholder drawn as `frame` and each key taken out, every placeholder's spot on
// screen and the keyed rows that can type.
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

// The next moment the spinner turns or, while a row types, its next letter is due — whichever comes
// first, so neither paces the other — but never past `until_ms`.
function next_turn(now_ms: number, until_ms: number, turning: Turning): number {
	const turn_ms = boundary_after(now_ms, SPINNER_INTERVAL_MS)
	const letter_ms = turning.typing.lines.length > 0 ? boundary_after(now_ms, LETTER_MS) : Infinity

	return Math.min(turn_ms, letter_ms, until_ms)
}

// The spinners turned when their frame changed, then the rows typing written over them, in one write.
function turn_bytes(turning: Turning, at_ms: number, is_turned: boolean): string {
	const spin = is_turned ? spin_bytes(turning.spots, spinner_of(at_ms)) : ''

	return `${spin}${run_board_type_rows.type_bytes(turning.typing, at_ms)}`
}

// joshuafolkken/kit#8123: a wake for a letter between frame boundaries writes no spinner, so each frame
// is written once, on its boundary.
async function turn_until(turning: Turning, ports: SpinPorts, until_ms: number): Promise<void> {
	let frame = spinner_of(ports.now())

	await poll.poll_until(() => ports.now() >= until_ms, {
		attempts: Infinity,
		interval_ms: 0,
		sleeper: async () => {
			const now_ms = ports.now()

			await ports.sleep(next_turn(now_ms, until_ms, turning) - now_ms)
			const at_ms = ports.now()
			const at_frame = spinner_of(at_ms)

			if (at_ms < until_ms) ports.write(turn_bytes(turning, at_ms, at_frame !== frame))
			frame = at_frame
		},
	})
}

// Waits for the next second, turning the spinners and typing the rows until then; a frame with neither
// just waits.
async function spin_to_second(turning: Turning, ports: SpinPorts): Promise<void> {
	const now_ms = ports.now()
	const second_ms = now_ms - (now_ms % REDRAW_MS) + REDRAW_MS

	if (turning.spots.length === 0 && turning.typing.lines.length === 0) {
		await ports.sleep(second_ms - now_ms)

		return
	}

	await turn_until(turning, ports, second_ms)
}

const run_board_spin = { REDRAW_MS, SPOT, spin_bytes, spin_to_second, spun }

export { run_board_spin }
export type { Spot, Spun, Turning }
