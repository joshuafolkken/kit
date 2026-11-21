import { run_board_cut_styled, type Piece } from './run-board-cut-styled'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_labels } from './run-board-labels'
import { run_board_rain, type Random } from './run-board-rain'

// joshuafolkken/kit#8356: the matrix board's new row arrives as code and resolves from the left — the
// matrix counterpart of the wargames row typing (`run-board-type-rows.ts`). The part resolved by now is the
// row as drawn; the two columns after it are the row's own characters in white-green; the rest up to the
// row's last character is the rain's glyphs, dim, a character two columns wide kept as it is (an icon
// stays readable), and the blanks after it stay blank — so the row is as wide while it decodes as after.

const { RESET, cut_styled, pieces_of } = run_board_cut_styled
const { SHADES } = run_board_header_trace
const { painted } = run_board_labels
const HEAD_COLUMNS = 2
// The code settles on new glyphs every this many columns resolved.
const SETTLE_COLUMNS = 8

// Where the code part is: the columns resolved, the blanks the row starts with, the column the row's
// last character ends at, the step its glyphs settle on and their random source.
interface CodeSpan {
	columns: number
	first: number
	last: number
	step: number
	random: Random
}

// The columns of blanks the row starts with — kept blank, as the demo leaves them.
function first_column(pieces: ReadonlyArray<Piece>): number {
	const start = pieces.findIndex((piece) => piece.width > 0 && piece.text.trim() !== '')

	return pieces.slice(0, Math.max(0, start)).reduce((sum, piece) => sum + piece.width, 0)
}

// The column the row's last character other than a blank ends at.
function last_column(pieces: ReadonlyArray<Piece>): number {
	let used = 0
	let last = 0

	for (const piece of pieces) {
		used += piece.width
		if (piece.width > 0 && piece.text.trim() !== '') last = used
	}

	return last
}

// One character past the resolved part, ending `used` columns in, as the code draws it.
function code_char(piece: Piece, used: number, span: CodeSpan): string {
	if (used > span.last || used <= span.first) return piece.text
	if (used - piece.width < span.columns + HEAD_COLUMNS) return painted(SHADES.head, piece.text)
	if (piece.width > 1) return painted(SHADES.dark, piece.text)

	return painted(SHADES.dark, run_board_rain.settled({ x: used, y: span.step }, span.random))
}

// A piece of the row as the code part draws it: none of the resolved part, no escape.
function code_piece(piece: Piece, used: number, span: CodeSpan): string {
	if (piece.width === 0 || used <= span.columns) return ''

	return code_char(piece, used, span)
}

// `text` with its first `columns` columns resolved and the rest code; whole once all are resolved.
function decoded(text: string, columns: number, random: Random = Math.random): string {
	const pieces = pieces_of(text)
	const span = {
		columns,
		first: first_column(pieces),
		last: last_column(pieces),
		step: Math.floor(columns / SETTLE_COLUMNS),
		random,
	}

	if (columns >= span.last) return text
	let used = 0
	const code = pieces.map((piece) => {
		used += piece.width

		return code_piece(piece, used, span)
	})

	return `${cut_styled(text, columns)}${code.join('')}${RESET}`
}

const run_board_decode = { HEAD_COLUMNS, decoded }

export { run_board_decode }
