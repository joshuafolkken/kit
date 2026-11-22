import { run_board_idle_rain, type RainMoment } from './run-board-idle-rain'
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
// step while the screen types (joshuafolkken/kit#8237) — and whether the cells run the idle rain instead.
interface LampMoment extends RainMoment {
	is_rain?: boolean | undefined
}

// One lamp on screen, 1-based, the row of the panel it is on (`run_board_lamps.PANEL_ROWS`, `0` the
// `24h`), its group and its place.
interface Lamp {
	row: number
	column: number
	panel_row: number
	// How many rows the frame's panel runs, which sets the idle rain's cycle (joshuafolkken/kit#8647).
	panel_rows: number
	group: number
	lamp: number
}

type LampPorts = Pick<BoardPorts, 'write' | 'write_drawn'>

function row_lamps(
	line: string,
	at: { row: number; panel_row: number; panel_rows: number },
	columns: number,
): Array<Lamp> {
	return [...line.matchAll(new RegExp(LAMP, 'gu'))].map((match, index) => ({
		...spot_at(line, match.index, at.row, columns),
		panel_row: at.panel_row,
		panel_rows: at.panel_rows,
		...place_of(at.panel_row, index),
	}))
}

// Every lamp in the frame's lines, which start on the screen rows `starts`; the panel's rows counted in
// order from the top — the `24h` row's first, the usage rows' last.
function lamps_in(
	lines: ReadonlyArray<string>,
	starts: ReadonlyArray<number>,
	columns: number,
): Array<Lamp> {
	const panel = [...lines.keys()].filter((index) => lines[index]?.includes(LAMP) === true)

	return panel.flatMap((index, panel_row) =>
		row_lamps(
			lines[index] ?? '',
			{ row: starts[index] ?? 1, panel_row, panel_rows: panel.length },
			columns,
		),
	)
}

// The lamp's cell as drawn `at`: lit or out, or the idle rain's cell where the frame runs it
// (joshuafolkken/kit#8356).
function cell_text(lamp: Lamp, at: LampMoment): string {
	if (at.is_rain === true) return run_board_idle_rain.cell_text(lamp, at)

	return lamp_text(lamp.panel_row, is_lit(at.ms, lamp.group, lamp.lamp, at.is_burst))
}

function lamp_bytes(lamp: Lamp, at: LampMoment): string {
	return `${CSI}${String(lamp.row)};${String(lamp.column)}H${cell_text(lamp, at)}`
}

// The lamps that changed since `since` written as they are `at`, every one with no `since`; each moment
// is read with its own burst, so a burst's start and end write just the lamps it changes.
function lamps_bytes(
	lamps: ReadonlyArray<Lamp>,
	at: LampMoment,
	since: LampMoment | undefined,
): string {
	const changed = lamps.filter(
		(lamp) => since === undefined || cell_text(lamp, at) !== cell_text(lamp, since),
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

// The frame's lines with each of `lamps` drawn as the idle rain's cell `at`, so a rain frame's whole draw
// writes no `■` for the turn to paint over (joshuafolkken/kit#8647); untouched with no `at`.
function rained(
	lines: ReadonlyArray<string>,
	lamps: ReadonlyArray<Lamp>,
	at: RainMoment | undefined,
): Array<string> {
	if (at === undefined) return [...lines]
	const cells = lamps.map((lamp) => run_board_idle_rain.cell_text(lamp, at)).values()

	return lines.map((line) => line.replaceAll(LAMP, () => cells.next().value ?? LAMP))
}

const run_board_lamp_spots = { lamps_in, rained, write_lamps }

export { run_board_lamp_spots }
export type { Lamp, LampMoment }
