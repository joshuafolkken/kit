import { run_board_fit } from './run-board-fit'

// A column's cell padded to one width on every line it is drawn on, so what follows it starts in one
// column.

const BLANK = ' '

// A row's column padded with blanks to the frame's width.
function cell_of(text: string | undefined, width: number): string {
	const drawn = text ?? ''

	return `${drawn}${BLANK.repeat(Math.max(0, width - run_board_fit.width_of(drawn)))}`
}

const run_board_render_slot = { cell_of }

export { run_board_render_slot }
