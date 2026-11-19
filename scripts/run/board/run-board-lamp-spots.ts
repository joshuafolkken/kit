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

// A moment the lamps are written at, and whether the panel bursts then — every group changing on every
// step while the screen types (joshuafolkken/kit#8237).
interface LampMoment {
	ms: number
	is_burst: boolean
}

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

function is_on(lamp: Lamp, at: LampMoment): boolean {
	return is_lit(at.ms, lamp.group, lamp.lamp, at.is_burst)
}

function lamp_bytes(lamp: Lamp, at: LampMoment): string {
	const cell = lamp_text(lamp.panel_row, is_on(lamp, at))

	return `${CSI}${String(lamp.row)};${String(lamp.column)}H${cell}`
}

// The lamps that changed since `since` written as they are `at`, every one with no `since`; each moment
// is read with its own burst, so a burst's start and end write just the lamps it changes.
function lamps_bytes(
	lamps: ReadonlyArray<Lamp>,
	at: LampMoment,
	since: LampMoment | undefined,
): string {
	const changed = lamps.filter(
		(lamp) => since === undefined || is_on(lamp, at) !== is_on(lamp, since),
	)

	return changed.map((lamp) => lamp_bytes(lamp, at)).join('')
}

function write_lamps(
	lamps: ReadonlyArray<Lamp>,
	ports: LampPorts,
	at: LampMoment,
	since: LampMoment | undefined,
): void {
	const bytes = lamps_bytes(lamps, at, since)

	if (bytes === '') return
	const write = ports.write_drawn ?? ports.write

	write(run_board_screen.synced(bytes))
}

const run_board_lamp_spots = { lamps_in, write_lamps }

export { run_board_lamp_spots }
export type { Lamp, LampMoment }
