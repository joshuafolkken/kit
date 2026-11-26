import { run_board_cells, type Cells } from './run-board-cells'
import type { TerminalSize } from './run-board-fit'
import { run_board_theme_host_frame } from './run-board-theme-host-frame'
import type { FinalCell, FinalGrid } from './run-board-theme-host-types'

// A theme host frame as kit's screen cells (joshuafolkken/kit#8917): each cell's character id and the
// id of its whole SGR — the painted style with the background wash last, so two cells that differ in
// the wash alone have different styles. Outside the frame the cells stay blank.

const { cells_of, char_id, put, style_id } = run_board_cells
const { sgr_of } = run_board_theme_host_frame

function put_row(cells: Cells, y: number, row: Array<FinalCell>): void {
	for (const [x, cell] of row.slice(0, cells.columns).entries()) {
		put(cells, y * cells.columns + x, char_id(cell[0]), style_id(sgr_of(cell), ''))
	}
}

function cells_of_frame(frame: FinalGrid, size: TerminalSize): Cells {
	const cells = cells_of(size)

	for (const [y, row] of frame.slice(0, size.rows).entries()) put_row(cells, y, row)

	return cells
}

const run_board_theme_host_cells = { cells_of_frame }

export { run_board_theme_host_cells }
