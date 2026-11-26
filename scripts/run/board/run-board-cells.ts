import type { TerminalSize } from './run-board-fit'

// A live `run:board` screen as cells (joshuafolkken/kit#8826): each cell's character and its style
// held in typed arrays, so a frame is composed, compared and written by cell instead of re-scanning
// ANSI text. A character is its code point, or an id past the last code point for a grapheme of
// several; a wide character's second cell holds `CONTINUATION`. A style id names one SGR run and
// hyperlink, interned once for every screen, so the same id means the same style on each.

// A grid of `rows` × `columns` cells, row by row.
interface Cells {
	rows: number
	columns: number
	chars: Uint32Array
	styles: Uint16Array
}

// The SGR sequences a cell is drawn with, after a reset, and the hyperlink it opens; '' for none.
interface Style {
	sgr: string
	link: string
}

const BLANK = ' '.codePointAt(0) ?? 0
const CONTINUATION = 0
// A cell an overlay never wrote (`run-board-layer.ts`).
const UNSET = 0xff_ff_ff_ff
const DEFAULT_STYLE = 0
const MAX_STYLE = 0xff_ff
const FIRST_GRAPHEME = 0x11_00_00
const STYLE_KEY_JOIN = '\u{0}'
const NO_STYLE: Style = { sgr: '', link: '' }

const styles: Array<Style> = [NO_STYLE]
const style_ids = new Map<string, number>([[STYLE_KEY_JOIN, DEFAULT_STYLE]])
const graphemes: Array<string> = []
const grapheme_ids = new Map<string, number>()

// The id of the style `sgr` with `link`, interned on first use; past the id space, the default.
function style_id(sgr: string, link: string): number {
	const key = `${link}${STYLE_KEY_JOIN}${sgr}`
	const known = style_ids.get(key)

	if (known !== undefined) return known
	if (styles.length > MAX_STYLE) return DEFAULT_STYLE
	style_ids.set(key, styles.length)
	styles.push({ sgr, link })

	return styles.length - 1
}

function style_of(id: number): Style {
	return styles[id] ?? NO_STYLE
}

// The id of one grapheme: its code point where it is one, else an interned id.
function char_id(grapheme: string): number {
	const point = grapheme.codePointAt(0) ?? BLANK

	if (String.fromCodePoint(point) === grapheme) return point
	const known = grapheme_ids.get(grapheme)

	if (known !== undefined) return known
	const id = FIRST_GRAPHEME + graphemes.length

	graphemes.push(grapheme)
	grapheme_ids.set(grapheme, id)

	return id
}

function char_text(id: number): string {
	if (id < FIRST_GRAPHEME) return String.fromCodePoint(id)

	return graphemes[id - FIRST_GRAPHEME] ?? ' '
}

// A grid of `size` with every cell `fill` in the default style.
function cells_of(size: TerminalSize, fill: number = BLANK): Cells {
	const count = size.rows * size.columns

	return {
		rows: size.rows,
		columns: size.columns,
		chars: new Uint32Array(count).fill(fill),
		styles: new Uint16Array(count),
	}
}

function is_sized(cells: Cells | undefined, size: TerminalSize): cells is Cells {
	return cells?.rows === size.rows && cells.columns === size.columns
}

// `to` made a copy of `from`, which is the same size.
function copy(from: Cells, to: Cells): void {
	to.chars.set(from.chars)
	to.styles.set(from.styles)
}

function put(cells: Cells, index: number, char: number, style: number): void {
	cells.chars[index] = char
	cells.styles[index] = style
}

const run_board_cells = {
	BLANK,
	CONTINUATION,
	DEFAULT_STYLE,
	MAX_STYLE,
	UNSET,
	cells_of,
	char_id,
	char_text,
	copy,
	is_sized,
	put,
	style_id,
	style_of,
}

export { run_board_cells }
export type { Cells, Style }
