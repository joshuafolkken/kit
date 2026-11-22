import { run_board_idle_rain, type RainMoment } from './run-board-idle-rain'
import { run_board_lamps } from './run-board-lamps'
import { run_board_spot } from './run-board-spot'

// The lamp panel's cells on screen (joshuafolkken/kit#8236), placed as the spinners are
// (`run-board-spin.ts`): the frame draws every lamp out, and the theme's painter writes each cell as it
// changes between redraws (`run-board-panel-draw.ts`), so no line of the frame changes from one step to
// the next.

const { LAMP, spot_at } = run_board_spot
const { place_of } = run_board_lamps

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

const run_board_lamp_spots = { lamps_in, rained }

export { run_board_lamp_spots }
export type { Lamp }
