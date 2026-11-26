import { run_board_lamps } from './run-board-lamps'
import { run_board_spot } from './run-board-spot'

// The lamp panel's cells on screen (joshuafolkken/kit#8236), placed as the spinners are
// (`run-board-spin.ts`): the frame draws every lamp out, and a themed board's theme layer lays its panel
// and area out by them (`run-board-theme-layout.ts`; joshuafolkken/kit#8917).

const { LAMP, spot_at } = run_board_spot
const { place_of } = run_board_lamps

// One lamp on screen, 1-based, the row of the panel it is on (`run_board_lamps.PANEL_ROWS`, `0` the
// `24h`), its group and its place.
interface Lamp {
	row: number
	column: number
	panel_row: number
	// How many rows the frame's panel runs (joshuafolkken/kit#8647).
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

const run_board_lamp_spots = { lamps_in }

export { run_board_lamp_spots }
export type { Lamp }
