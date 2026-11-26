import string_width from 'string-width'
import { run_board_cells, type Cells } from './run-board-cells'
import { run_board_theme_host_cells } from './run-board-theme-host-cells'
import type { FinalCell, FinalGrid, Point } from './run-board-theme-host-types'

// A theme host frame put on a live board's canvas (joshuafolkken/kit#8917). A cell keeps the hyperlink
// the base drew it with where the theme left its character as it was; a wide character's second half
// stays with its first only where the theme kept both; nothing is put past the canvas's rows or columns.
// Each theme draws its own level indicator in the frame (the real level reaches it on the timeline).

const { BLANK, CONTINUATION, char_id, char_text, put, style_id, style_of } = run_board_cells
const WIDE = 2

// A wide character's second half where the cell before it, as just put, is a wide character; else blank.
function second_half(canvas: Cells, index: number): number {
	const before = char_text(canvas.chars[index - 1] ?? BLANK)

	return string_width(before) >= WIDE ? CONTINUATION : BLANK
}

// Whether the theme took the second half of a wide base character starting at `index`.
function is_split(canvas: Cells, index: number, next: FinalCell | undefined): boolean {
	return canvas.chars[index + 1] === CONTINUATION && next?.[0] !== ''
}

// A character put where the base may hold a wide one: blank where the theme took its second half.
function first_half(
	canvas: Cells,
	index: number,
	row: ReadonlyArray<FinalCell>,
	x: number,
): number {
	if (is_split(canvas, index, row[x + 1])) return BLANK

	return char_id(row[x]?.[0] ?? ' ')
}

// The character a frame cell puts at `index`, the cells before it already put.
function char_for(canvas: Cells, index: number, row: ReadonlyArray<FinalCell>, x: number): number {
	return row[x]?.[0] === '' ? second_half(canvas, index) : first_half(canvas, index, row, x)
}

// The frame cell's style as the host's converter made it (`run-board-theme-host-cells.ts`), carrying
// the base cell's link where its character was kept.
function style_for(canvas: Cells, themed: Cells, index: number, is_kept: boolean): number {
	const style = themed.styles[index] ?? 0
	const link = is_kept ? style_of(canvas.styles[index] ?? 0).link : ''

	return link === '' ? style : style_id(style_of(style).sgr, link)
}

// The base's character kept, its case aside: a theme that draws in capitals (`wopr`, `magi`, …) keeps
// the link of every letter it only raised.
function is_base_char(char: number, base: number | undefined): boolean {
	if (base === undefined || char === base) return char === base

	return char_text(char) === char_text(base).toUpperCase()
}

function put_cell(canvas: Cells, themed: Cells, row: ReadonlyArray<FinalCell>, at: Point): void {
	const index = at.y * canvas.columns + at.x
	const char = char_for(canvas, index, row, at.x)

	put(
		canvas,
		index,
		char,
		style_for(canvas, themed, index, is_base_char(char, canvas.chars[index])),
	)
}

// `frame` put over `canvas`, which holds the base it was drawn from.
function put_frame(canvas: Cells, frame: FinalGrid): void {
	const themed = run_board_theme_host_cells.cells_of_frame(frame, canvas)

	for (const [y, row] of frame.slice(0, canvas.rows).entries()) {
		for (let x = 0; x < Math.min(row.length, canvas.columns); x++) {
			put_cell(canvas, themed, row, { y, x })
		}
	}
}

const run_board_theme_canvas = { put_frame }

export { run_board_theme_canvas }
