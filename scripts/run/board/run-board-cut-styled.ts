import { run_board_escape } from './run-board-escape'
import { run_board_fit } from './run-board-fit'

// joshuafolkken/kit#8003: a drawn line cut to its first columns with its colors and links kept, so a
// row being typed (`run-board-type-rows.ts`) shows the part typed so far as the whole row draws it. A
// color escape (SGR) and a link's escapes (OSC 8, tmux-wrapped or not — `run-board-escape.ts`) take no
// column; the cut closes both after it.

const ESC = '\u{1B}'
const { is_escape } = run_board_escape
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
		.split(run_board_escape.LINE_ESCAPE)
		.flatMap((part) => (is_escape(part) ? { text: part, width: 0 } : graphemes(part)))
}

// The escape closing the link the cut leaves open — the last link escape kept opens one — wrapped as
// its opening is; none when no link is left open.
function link_close_of(kept: ReadonlyArray<Piece>): string {
	const last = kept.findLast((piece) => run_board_escape.is_link(piece.text))

	if (last === undefined || !run_board_escape.is_link_open(last.text)) return ''

	return run_board_escape.link_close_for(last.text)
}

// joshuafolkken/kit#8632: the reset closing a cut of `pieces` — none for a line with no escape, so a
// colorless board stays free of escapes.
function reset_for(pieces: ReadonlyArray<Piece>): string {
	return pieces.some((piece) => is_escape(piece.text)) ? RESET : ''
}

// `line` cut to its first `columns` columns; a character two columns wide the cut would split is left
// out whole. A link the cut leaves open is closed, and the colors reset where the line has any escape.
function cut_styled(line: string, columns: number): string {
	let used = 0
	const pieces = pieces_of(line)
	const kept = pieces.filter((piece) => {
		used += piece.width

		return used <= columns
	})
	const text = kept.map((piece) => piece.text).join('')

	return `${text}${link_close_of(kept)}${reset_for(pieces)}`
}

// One piece of a line's tail, `used` columns in once it is drawn: every escape, so the colors and links
// before the cut still hold; no character the cut takes; blanks for the part of one it splits.
function tail_piece(piece: Piece, used: number, columns: number): string {
	if (piece.width === 0) return piece.text
	if (used <= columns) return ''

	return used - piece.width < columns ? ' '.repeat(used - columns) : piece.text
}

// joshuafolkken/kit#8457: `line` past its first `columns` columns, its colors and links kept — the
// saved line a typing row is written over, right of the block — and the colors reset where the line
// has any escape.
function tail_styled(line: string, columns: number): string {
	let used = 0
	const pieces = pieces_of(line)
	const kept = pieces.map((piece) => {
		used += piece.width

		return tail_piece(piece, used, columns)
	})

	return `${kept.join('')}${reset_for(pieces)}`
}

// A drawn line's character with the color escapes that hold at it (joshuafolkken/kit#8367) and the
// link escape it is drawn inside, where one is open (joshuafolkken/kit#8353).
interface StyledPiece extends Piece {
	style: string
	link?: string | undefined
}

const SGR_START = `${ESC}[`

// The color escapes holding after `escape`: a reset clears them, a link's escape leaves them.
function style_after(style: string, escape: string): string {
	if (!escape.startsWith(SGR_START)) return style

	return escape === RESET || escape === `${SGR_START}m` ? '' : `${style}${escape}`
}

// The link escape holding after `escape`: a link's opening sets it, its close clears it.
function link_after(link: string, escape: string): string {
	if (!run_board_escape.is_link(escape)) return link

	return run_board_escape.is_link_open(escape) ? escape : ''
}

// The colors and the link holding at a point of the line.
interface Held {
	style: string
	link: string
}

function held_after(held: Held, escape: string): Held {
	return { style: style_after(held.style, escape), link: link_after(held.link, escape) }
}

function styled_of(piece: Piece, held: Held): StyledPiece {
	return held.link === '' ? { ...piece, style: held.style } : { ...piece, ...held }
}

// The line's characters, each with the color escapes written since the last reset before it and the
// link open at it — the same split `cut_styled` cuts by.
function styled_pieces(line: string): Array<StyledPiece> {
	let held: Held = { style: '', link: '' }
	const styled: Array<StyledPiece> = []

	for (const piece of pieces_of(line)) {
		if (piece.text.startsWith(ESC)) held = held_after(held, piece.text)
		else styled.push(styled_of(piece, held))
	}

	return styled
}

const run_board_cut_styled = {
	cut_styled,
	pieces_of,
	styled_pieces,
	tail_styled,
}

export { run_board_cut_styled }
export type { Piece, StyledPiece }
