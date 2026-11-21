import { run_board_fit } from './run-board-fit'

// joshuafolkken/kit#8003: a drawn line cut to its first columns with its colors and links kept, so a
// row being typed (`run-board-type-rows.ts`) shows the part typed so far as the whole row draws it. A
// color escape (SGR) and a link's escapes (OSC 8) take no column; the cut closes both after it.

const ESC = '\u{1B}'
const BEL = '\u{7}'
// A color escape, or a link's opening or closing escape ended by BEL or ST; captured, so a split keeps it.
const ESCAPE = new RegExp(
	String.raw`(${ESC}\[[\d;]*m|${ESC}\]8;[^${BEL}${ESC}]*(?:${BEL}|${ESC}\\))`,
	'u',
)
const LINK_START = `${ESC}]8;`
const LINK_CLOSE = `${ESC}]8;;${BEL}`
// A link's closing escape: one with no URI, ended by BEL or ST.
const LINK_CLOSE_ENDS = [`;${BEL}`, `;${ESC}\\`]
const RESET = `${ESC}[0m`
const SEGMENTER = new Intl.Segmenter()

interface Piece {
	text: string
	width: number
}

function graphemes(text: string): Array<Piece> {
	return Array.from(SEGMENTER.segment(text), ({ segment }) => ({
		text: segment,
		width: run_board_fit.width_of(segment),
	}))
}

// The line's escapes, each no column, and its characters, each as wide as it draws.
function pieces_of(line: string): Array<Piece> {
	return line
		.split(ESCAPE)
		.flatMap((part) => (part.startsWith(ESC) ? { text: part, width: 0 } : graphemes(part)))
}

// Whether the last link escape kept opens a link — one the cut leaves open.
function is_link_open(kept: ReadonlyArray<Piece>): boolean {
	const last = kept.findLast((piece) => piece.text.startsWith(LINK_START))

	if (last === undefined) return false

	return LINK_CLOSE_ENDS.every((end) => !last.text.endsWith(end))
}

// `line` cut to its first `columns` columns; a character two columns wide the cut would split is left
// out whole. A link the cut leaves open is closed, and the colors reset.
function cut_styled(line: string, columns: number): string {
	let used = 0
	const kept = pieces_of(line).filter((piece) => {
		used += piece.width

		return used <= columns
	})
	const text = kept.map((piece) => piece.text).join('')
	const close = is_link_open(kept) ? LINK_CLOSE : ''

	return `${text}${close}${RESET}`
}

// One piece of a line's tail, `used` columns in once it is drawn: every escape, so the colors and links
// before the cut still hold; no character the cut takes; blanks for the part of one it splits.
function tail_piece(piece: Piece, used: number, columns: number): string {
	if (piece.width === 0) return piece.text
	if (used <= columns) return ''

	return used - piece.width < columns ? ' '.repeat(used - columns) : piece.text
}

// joshuafolkken/kit#8457: `line` past its first `columns` columns, its colors and links kept — the
// saved line a typing row is written over, right of the block — and the colors reset.
function tail_styled(line: string, columns: number): string {
	let used = 0
	const kept = pieces_of(line).map((piece) => {
		used += piece.width

		return tail_piece(piece, used, columns)
	})

	return `${kept.join('')}${RESET}`
}

const run_board_cut_styled = { cut_styled, tail_styled }

export { run_board_cut_styled }
