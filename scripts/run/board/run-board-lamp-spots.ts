import { run_board_lamps } from './run-board-lamps'
import { run_board_screen } from './run-board-screen'
import { run_board_spot } from './run-board-spot'
import type { BoardPorts } from './run-board-state'

// The lamp panel's cells on screen and the bytes that blink them between redraws (joshuafolkken/kit#8236),
// placed as the spinners are (`run-board-spin.ts`): the frame draws every lamp out, and only a lamp's own
// cell is written as it changes, so no line of the frame changes from one step to the next. The writes go
// past the theme (`write_drawn`), so they are not held in its line cache.

const { LAMP, spot_at } = run_board_spot
const { is_lit, lamp_text, place_of } = run_board_lamps
const CSI = '\u{1B}['
// The panel blinks its groups apart, never in a burst.
const is_burst = false

// One lamp on screen, 1-based, the row of the panel it is on (`0` the `24h`), its group and its place.
interface Lamp {
	row: number
	column: number
	panel_row: number
	group: number
	lamp: number
}

type LampPorts = Pick<BoardPorts, 'write' | 'write_drawn'>

function row_lamps(
	line: string,
	at: { row: number; panel_row: number },
	columns: number,
): Array<Lamp> {
	return [...line.matchAll(new RegExp(LAMP, 'gu'))].map((match, index) => ({
		...spot_at(line, match.index, at.row, columns),
		panel_row: at.panel_row,
		...place_of(at.panel_row, index),
	}))
}

// Every lamp in the frame's lines, which start on the screen rows `starts`; the panel's rows counted in
// order, the `24h` row's first.
function lamps_in(
	lines: ReadonlyArray<string>,
	starts: ReadonlyArray<number>,
	columns: number,
): Array<Lamp> {
	const panel = [...lines.keys()].filter((index) => lines[index]?.includes(LAMP) === true)

	return panel.flatMap((index, panel_row) =>
		row_lamps(lines[index] ?? '', { row: starts[index] ?? 1, panel_row }, columns),
	)
}

function is_on(lamp: Lamp, at_ms: number): boolean {
	return is_lit(at_ms, lamp.group, lamp.lamp, is_burst)
}

function lamp_bytes(lamp: Lamp, at_ms: number): string {
	const cell = lamp_text(lamp.panel_row, is_on(lamp, at_ms))

	return `${CSI}${String(lamp.row)};${String(lamp.column)}H${cell}`
}

// The lamps that changed since `since_ms` written as they are at `at_ms`, every one with no `since_ms`.
function lamps_bytes(
	lamps: ReadonlyArray<Lamp>,
	at_ms: number,
	since_ms: number | undefined,
): string {
	const changed = lamps.filter(
		(lamp) => since_ms === undefined || is_on(lamp, at_ms) !== is_on(lamp, since_ms),
	)

	return changed.map((lamp) => lamp_bytes(lamp, at_ms)).join('')
}

function write_lamps(
	lamps: ReadonlyArray<Lamp>,
	ports: LampPorts,
	at_ms: number,
	since_ms: number | undefined,
): void {
	const bytes = lamps_bytes(lamps, at_ms, since_ms)

	if (bytes === '') return
	const write = ports.write_drawn ?? ports.write

	write(run_board_screen.synced(bytes))
}

const run_board_lamp_spots = { lamps_in, write_lamps }

export { run_board_lamp_spots }
export type { Lamp }
