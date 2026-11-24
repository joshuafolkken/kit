import string_width from 'string-width'
import { run_board_cells, type Cells } from './run-board-cells'
import { run_board_sgr } from './run-board-sgr'

// ANSI text painted onto cells (joshuafolkken/kit#8826) as a terminal would draw it: SGR runs and
// OSC 8 hyperlinks set the style, a cursor move (CSI row;column H), an erase to the line's end (CSI K)
// or the screen's (CSI J, CSI 2J) move or blank cells, a newline goes to the next row's first column,
// and each grapheme takes its display width, wrapping at the last column. What falls past the last row
// is dropped; any other control is skipped.

const { BLANK, CONTINUATION, char_id, put, style_id } = run_board_cells
const ESC = '\u{1B}'
const BEL = '\u{7}'
// One escape sequence (CSI or an OSC ended by BEL or ST), or a run of text without one.
const TOKEN = new RegExp(
	`${ESC}\\[[0-?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}.?|[^${ESC}]+`,
	'gu',
)
const CSI_PARTS = new RegExp(`^${ESC}\\[([0-?]*)[ -/]*([@-~])$`, 'u')
const OSC_LINK = new RegExp(`^${ESC}\\]8;[^;]*;([^${BEL}${ESC}]*)`, 'u')
const LINE_BREAK = /([\n\r])/u
const SEGMENTER = new Intl.Segmenter()
const WIDE = 2
const ERASE_ALL = '2'

// Where the next grapheme goes, and the style it is drawn in.
interface Pen {
	row: number
	column: number
	sgr: string
	link: string
}

type CsiAction = (cells: Cells, pen: Pen, parameters: string) => void

function style_of_pen(pen: Pen): number {
	return style_id(pen.sgr, pen.link)
}

// The cell a wide character's half was overwritten in, blanked, so no half of one is left.
function unpair(cells: Cells, index: number): void {
	const { chars } = cells

	if (chars[index] === CONTINUATION && index % cells.columns > 0) chars[index - 1] = BLANK

	if (chars[index + 1] === CONTINUATION && (index + 1) % cells.columns > 0) {
		chars[index + 1] = BLANK
	}
}

// One grapheme at the pen, wrapped to the next row where it does not fit.
function place(cells: Cells, pen: Pen, grapheme: string): void {
	const width = string_width(grapheme)

	if (width === 0) return
	if (pen.column + width > cells.columns) Object.assign(pen, { row: pen.row + 1, column: 0 })
	if (pen.row >= cells.rows) return
	const index = pen.row * cells.columns + pen.column
	const style = style_of_pen(pen)

	unpair(cells, index)
	put(cells, index, char_id(grapheme), style)
	if (width >= WIDE) put(cells, index + 1, CONTINUATION, style)
	pen.column += width
}

const BREAKS: Readonly<Record<string, (pen: Pen) => void>> = {
	'\n': (pen) => {
		Object.assign(pen, { row: pen.row + 1, column: 0 })
	},
	'\r': (pen) => {
		pen.column = 0
	},
}

function line_onto(cells: Cells, pen: Pen, line: string): void {
	for (const { segment } of SEGMENTER.segment(line)) place(cells, pen, segment)
}

function text_onto(cells: Cells, pen: Pen, text: string): void {
	for (const part of text.split(LINE_BREAK)) {
		const line_break = BREAKS[part]

		if (line_break === undefined) line_onto(cells, pen, part)
		else line_break(pen)
	}
}

// Cells from `start` to before `end` blanked in the pen's style.
function blank(cells: Cells, pen: Pen, start: number, end: number): void {
	const from = Math.max(0, start)
	const to = Math.min(end, cells.chars.length)

	if (from >= to) return
	cells.chars.fill(BLANK, from, to)
	cells.styles.fill(style_of_pen(pen), from, to)
}

function pen_index(cells: Cells, pen: Pen): number {
	return pen.row * cells.columns + Math.min(pen.column, cells.columns)
}

function erase_line(cells: Cells, pen: Pen): void {
	blank(cells, pen, pen_index(cells, pen), (pen.row + 1) * cells.columns)
}

function erase_screen(cells: Cells, pen: Pen, parameters: string): void {
	const from = parameters === ERASE_ALL ? 0 : pen_index(cells, pen)

	blank(cells, pen, from, cells.chars.length)
}

function move(_cells: Cells, pen: Pen, parameters: string): void {
	const [row = 1, column = 1] = parameters.split(';').map((part) => Number(part) || 1)

	Object.assign(pen, { row: row - 1, column: column - 1 })
}

// The pen's style after the SGR, reduced to what it leaves so a run re-colored per character keeps one.
function restyle(_cells: Cells, pen: Pen, parameters: string): void {
	pen.sgr = run_board_sgr.after(pen.sgr, parameters)
}

const CSI_ACTIONS: Readonly<Record<string, CsiAction>> = {
	m: restyle,
	H: move,
	f: move,
	K: erase_line,
	J: erase_screen,
}

function csi_onto(cells: Cells, pen: Pen, token: string): void {
	const [, parameters = '', code = ''] = CSI_PARTS.exec(token) ?? []

	CSI_ACTIONS[code]?.(cells, pen, parameters)
}

// An OSC 8 hyperlink opened, or closed by an empty one; any other OSC is skipped.
function osc_onto(pen: Pen, token: string): void {
	const link = OSC_LINK.exec(token)

	if (link !== null) pen.link = link[1] ?? ''
}

function token_onto(cells: Cells, pen: Pen, token: string): void {
	if (!token.startsWith(ESC)) text_onto(cells, pen, token)
	else if (token.startsWith(`${ESC}[`)) csi_onto(cells, pen, token)
	else osc_onto(pen, token)
}

// `text` painted onto `cells` from the top-left cell, in the default style.
function paint(cells: Cells, text: string): void {
	const pen: Pen = { row: 0, column: 0, sgr: '', link: '' }

	for (const [token] of text.matchAll(TOKEN)) token_onto(cells, pen, token)
}

const run_board_cells_ansi = { paint, unpair }

export { run_board_cells_ansi }
