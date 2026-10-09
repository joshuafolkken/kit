import { stripVTControlCharacters } from 'node:util'
import { run_progress } from '#scripts/run/progress/run-progress'
import string_width from 'string-width'
import { run_board_fit, type TerminalSize } from './run-board-fit'
import { run_board_labels } from './run-board-labels'
import type { BoardPorts } from './run-board-state'

// The spinners of a live `run:board` frame turned between redraws. The frame
// is redrawn once a second, on the second, and between redraws only the spinners' own cells are written
// at the package's interval: a cursor move and one character each, with no read, layout or render. The
// renderer draws a placeholder where a spinner goes, and each placeholder's place on screen — its row
// after the lines above it wrap, its column by display width — is recorded as the frame is written. A
// row the frame was cut to the terminal's rows without is not on screen, so it records nothing.

// A private-use character one column wide, as a spinner frame is, so the frame is fitted the same.
const SPOT = '\u{E000}'
const REDRAW_MS = run_progress.MS_PER_SECOND
const CSI = '\u{1B}['
const RESET = `${CSI}0m`
// eslint-disable-next-line no-control-regex -- the color escapes a spot keeps are control characters
const SGR = /\u{1B}\[[\d;]*m/gu
const { SPINNER_INTERVAL_MS, spinner_of } = run_board_labels

// Where one spinner is on screen, 1-based, and the colors in effect where it is drawn.
interface Spot {
	row: number
	column: number
	style: string
}

interface Spun {
	lines: Array<string>
	spots: Array<Spot>
}

type SpinPorts = Pick<BoardPorts, 'now' | 'sleep' | 'write'>

// The spot of the placeholder at `index` in a line that starts `row` rows down the screen.
function spot_at(line: string, index: number, row: number, columns: number): Spot {
	const before = line.slice(0, index)
	const width = string_width(stripVTControlCharacters(before))
	const style = (before.match(SGR) ?? []).join('')

	return { row: row + Math.floor(width / columns), column: (width % columns) + 1, style }
}

function line_spots(line: string, row: number, columns: number): Array<Spot> {
	return [...line.matchAll(new RegExp(SPOT, 'gu'))].map((match) =>
		spot_at(line, match.index, row, columns),
	)
}

// The frame with each placeholder drawn as `frame`, and every placeholder's spot that is on screen.
function spun(lines: ReadonlyArray<string>, frame: string, size?: TerminalSize): Spun {
	const columns = Math.max(1, size?.columns ?? Infinity)
	const rows = size?.rows ?? Infinity
	let row = 1
	const spots = lines.flatMap((line) => {
		const found = line_spots(line, row, columns)

		row += run_board_fit.height_of(line, columns)

		return found
	})

	return {
		lines: lines.map((line) => line.split(SPOT).join(frame)),
		spots: spots.filter((spot) => spot.row <= rows),
	}
}

// One spinner frame at every spot: the cursor moved there, the spot's colors, the frame, then a reset.
function spin_bytes(spots: ReadonlyArray<Spot>, frame: string): string {
	return spots
		.map((spot) => `${CSI}${String(spot.row)};${String(spot.column)}H${spot.style}${frame}${RESET}`)
		.join('')
}

// The next moment the spinner turns, but never past `until_ms`.
function next_turn(now_ms: number, until_ms: number): number {
	return Math.min(now_ms - (now_ms % SPINNER_INTERVAL_MS) + SPINNER_INTERVAL_MS, until_ms)
}

async function turn_until(
	spots: ReadonlyArray<Spot>,
	ports: SpinPorts,
	until_ms: number,
): Promise<void> {
	for (let now = ports.now(); now < until_ms; now = ports.now()) {
		// eslint-disable-next-line no-await-in-loop -- polling: each turn waits for the spinner's next frame
		await ports.sleep(next_turn(now, until_ms) - now)
		const at_ms = ports.now()

		if (at_ms < until_ms) ports.write(spin_bytes(spots, spinner_of(at_ms)))
	}
}

// Waits for the next second, turning the spinners until then; a frame with none just waits.
async function spin_to_second(spots: ReadonlyArray<Spot>, ports: SpinPorts): Promise<void> {
	const now_ms = ports.now()
	const second_ms = now_ms - (now_ms % REDRAW_MS) + REDRAW_MS

	if (spots.length === 0) {
		await ports.sleep(second_ms - now_ms)

		return
	}

	await turn_until(spots, ports, second_ms)
}

const run_board_spin = { REDRAW_MS, SPOT, spin_bytes, spin_to_second, spun }

export { run_board_spin }
export type { Spot, Spun }
