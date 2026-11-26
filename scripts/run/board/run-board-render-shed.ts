import { stripVTControlCharacters } from 'node:util'
import { run_board_fit } from './run-board-fit'
import { run_board_render_title } from './run-board-render-title'

// A lane row that still runs past the pane once its title is cut to nothing gives up its tail's cells,
// the least needed first, each with the gap before it (joshuafolkken/kit#8990): the drift (`+35′`) and
// the blanks that line it up with other rows, the finish (`🎯 18:46`), CodeRabbit's mark (`🐰 ⏳`), then
// the checks' counts — `PR <n>` stays. A row that runs past the pane even then is cut at its end, drawn
// plain so the cut splits no escape sequence.

const SHED_ORDER = ['drift', 'finish', 'review', 'counts'] as const

type ShedCell = (typeof SHED_ORDER)[number]

// Whether a row that gives up `shed` cells gives up `cell`.
function is_shed(cell: ShedCell, shed: number): boolean {
	return SHED_ORDER.indexOf(cell) < shed
}

function is_within(line: string, columns: number): boolean {
	return run_board_fit.width_of(line) <= columns
}

// The row's line that fits `columns`: `line` where it does, else the first that does as `draw` gives up
// one more cell each time, else the line with every cell given up, cut at its end.
function shed_fitted(
	line: string,
	columns: number | undefined,
	draw: (shed: number) => string,
): string {
	if (columns === undefined || is_within(line, columns)) return line

	const sheds = Array.from({ length: SHED_ORDER.length }, (_, index) => index + 1)
	const fitting = sheds.map((shed) => draw(shed)).find((shed_line) => is_within(shed_line, columns))

	return (
		fitting ??
		run_board_render_title.columns_cut(stripVTControlCharacters(draw(SHED_ORDER.length)), columns)
	)
}

const run_board_render_shed = { SHED_ORDER, is_shed, shed_fitted }

export { run_board_render_shed, type ShedCell }
