import { run_board_fit } from './run-board-fit'

// joshuafolkken/kit#8003: a drawn line cut to its first columns with its colors and links kept, so a
// row being typed (`run-board-type-rows.ts`) shows the part typed so far as the whole row draws it. A
// color escape (SGR) and a link's escapes (OSC 8) take no column; the cut closes both after it.

const ESC = '\u{1B}'
const BEL = '\u{7}'
// A color escape, or a link's opening or closing escape ended by BEL or ST; captured, so a split keeps it.
const ESCAPE = new RegExp(
	`(${ESC}\\[[\\d;]*m|${ESC}\\]8;[^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\))`,
	'u',
)
const LINK_START = `${ESC}]8;`
const LINK_CLOSE = `${ESC}]8;;${BEL}`
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

// `line` cut to its first `columns` columns; a character two columns wide the cut would split is left
// out whole. A link the cut leaves open is closed, and the colors reset.
function cut_styled(line: string, columns: number): string {
	let used = 0
	const kept = pieces_of(line).filter((piece) => {
		used += piece.width

		return used <= columns
	})
	const text = kept.map((piece) => piece.text).join('')
	const close = text.includes(LINK_START) ? LINK_CLOSE : ''

	return `${text}${close}${RESET}`
}

const run_board_cut_styled = { cut_styled }

export { run_board_cut_styled }
