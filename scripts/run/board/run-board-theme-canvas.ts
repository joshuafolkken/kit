import string_width from 'string-width'
import { run_board_cells, type Cells } from './run-board-cells'
import { run_board_theme_host_cells } from './run-board-theme-host-cells'
import type { FinalCell, FinalGrid } from './run-board-theme-host-types'

// A theme host frame put on a live board's canvas (joshuafolkken/kit#8917). A cell keeps the hyperlink
// the base drew it with where the theme left its character as it was — a blank only between words that
// kept theirs, so no linked blank is left on a screen a part emptied; a wide character's second half
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

// The base's character kept, its case aside: a theme that draws in capitals (`wopr`, `magi`, …) keeps
// the link of every letter it only raised.
function is_base_char(char: number, base: number | undefined): boolean {
	if (base === undefined || char === base) return char === base

	return char_text(char) === char_text(base).toUpperCase()
}

// One frame row being put: the cell before the one put, as the link the base drew it with and the
// link it was put with.
interface Line {
	row: ReadonlyArray<FinalCell>
	y: number
	before: { base: string; put: string }
}

function link_of(canvas: Cells, index: number): string {
	return style_of(canvas.styles[index] ?? 0).link
}

function is_linked_blank(canvas: Cells, index: number, link: string): boolean {
	return canvas.chars[index] === BLANK && link_of(canvas, index) === link
}

// The first cell right of `index` on its row the base drew in `link` and not blank; none where the
// link's cells end on blanks.
function next_drawn(canvas: Cells, index: number, link: string): number | undefined {
	const end = index - (index % canvas.columns) + canvas.columns
	let next = index + 1

	while (next < end && is_linked_blank(canvas, next, link)) next += 1

	return next < end && link_of(canvas, next) === link ? next : undefined
}

// Whether the frame keeps the base's character at `index`, a cell right of those already put.
function is_kept_at(canvas: Cells, row: ReadonlyArray<FinalCell>, index: number): boolean {
	return is_base_char(first_half(canvas, index, row, index % canvas.columns), canvas.chars[index])
}

// Whether a blank the base drew in `link` still joins that link's words: the word on each side it has
// kept its link. A terminal underlines a linked blank, so one whose words a part blanked — an opening,
// an ending, an effect — would stay on the empty screen as a dash.
function is_joining(canvas: Cells, line: Line, index: number, link: string): boolean {
	const next = next_drawn(canvas, index, link)
	const sides = [
		line.before.base === link ? line.before.put === link : undefined,
		next === undefined ? undefined : is_kept_at(canvas, line.row, next),
	].filter((side) => side !== undefined)

	return sides.length > 0 && sides.every(Boolean)
}

// The base's link the cell put at `index` carries: its own where its character was kept — a blank's
// only while it joins its link's words; none elsewhere.
function kept_link(canvas: Cells, line: Line, index: number, char: number): string {
	const link = link_of(canvas, index)

	if (link === '' || !is_base_char(char, canvas.chars[index])) return ''
	if (char !== BLANK) return link

	return is_joining(canvas, line, index, link) ? link : ''
}

// The frame cell put in the style the host's converter made it (`run-board-theme-host-cells.ts`),
// carrying the base cell's link where it keeps one.
function put_cell(canvas: Cells, themed: Cells, line: Line, x: number): void {
	const index = line.y * canvas.columns + x
	const char = char_for(canvas, index, line.row, x)
	const link = kept_link(canvas, line, index, char)
	const style = themed.styles[index] ?? 0

	line.before = { base: link_of(canvas, index), put: link }
	put(canvas, index, char, link === '' ? style : style_id(style_of(style).sgr, link))
}

// `frame` put over `canvas`, which holds the base it was drawn from.
function put_frame(canvas: Cells, frame: FinalGrid): void {
	const themed = run_board_theme_host_cells.cells_of_frame(frame, canvas)

	for (const [y, row] of frame.slice(0, canvas.rows).entries()) {
		const line: Line = { row, y, before: { base: '', put: '' } }

		for (let x = 0; x < Math.min(row.length, canvas.columns); x++) put_cell(canvas, themed, line, x)
	}
}

const run_board_theme_canvas = { put_frame }

export { run_board_theme_canvas }
