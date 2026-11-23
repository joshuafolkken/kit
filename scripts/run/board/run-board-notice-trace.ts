import { styleText } from 'node:util'
import { run_board_cut_styled, type StyledPiece } from './run-board-cut-styled'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_labels, type Paint } from './run-board-labels'
import { run_board_rain, type Random } from './run-board-rain'
import { run_board_row_key } from './run-board-row-key'

// joshuafolkken/kit#8658: the board's notice trace (joshuafolkken/kit#8657's approved demo). A new notice
// arrives — in matrix its letters spin as the rain's glyphs in the head's white-green and lock from the
// left one per `LETTER_MS`, elsewhere the theme types it — then an inverse bar in the theme's lit color,
// one column past each end, is lit and off three times (joshuafolkken/kit#8745), and the notice holds lit
// until it changes. Pure: the time and the random are passed in.

const LETTER_MS = 50
const TRACE_BLINK_MS = 1000
const TRACE_GAP_MS = 1000
const BLINKS = 3

// The notice slot's empty state (`run-board-header-notice.ts` → `NONE`) never traces.
const NONE_KEY = run_board_row_key.key_of('notice', '—')
// The traced text is the notice with the column drawn before and after it, where the bar reaches.
const MARGINS = 2
const BLANK = ' '

// How a theme's notice traces: the color it is lit and barred in, and whether it arrives as the rain.
interface NoticeLook {
	lit: Paint
	is_rain: boolean
}

type Stage = 'bar' | 'lit'

const PAIR_MS = TRACE_BLINK_MS + TRACE_GAP_MS

// What the notice shows once its last letter lands, by how long it has: each stage until its time, bar
// and lit alternating from a bar; past the last bar it holds lit.
const STAGES: ReadonlyArray<readonly [number, Stage]> = Array.from(
	{ length: BLINKS },
	(_, index): ReadonlyArray<readonly [number, Stage]> => [
		[index * PAIR_MS + TRACE_BLINK_MS, 'bar'],
		[(index + 1) * PAIR_MS, 'lit'],
	],
)
	.flat()
	.slice(0, -1)

const { RESET } = run_board_cut_styled
const { SHADES } = run_board_header_trace
const { painted } = run_board_labels

function stage_of(held_ms: number): Stage {
	return STAGES.find(([until_ms]) => held_ms < until_ms)?.[1] ?? 'lit'
}

function lit(look: NoticeLook, text: string): string {
	return painted(look.lit, text)
}

function bar(look: NoticeLook, text: string): string {
	return styleText('inverse', lit(look, text))
}

// A column as the frame draws it, its colors closed after it.
function as_drawn(piece: StyledPiece): string {
	return piece.style === '' ? piece.text : `${piece.style}${piece.text}${RESET}`
}

// A rain glyph in the head's color, padded to the letter's width so a wide letter keeps its columns.
function spun(piece: StyledPiece, random: Random): string {
	return `${painted(SHADES.head, run_board_rain.fresh(random))}${BLANK.repeat(piece.width - 1)}`
}

function is_blank(piece: StyledPiece): boolean {
	return piece.width === 0 || piece.text.trim() === ''
}

type Letter = (piece: StyledPiece, index: number) => string
type Margin = (piece: StyledPiece) => string

// The traced text's pieces: its two margins and the letters between them, each drawn its own way.
function framed(pieces: ReadonlyArray<StyledPiece>, letter: Letter, margin: Margin): string {
	const last = pieces.length - 1

	return pieces
		.map((piece, index) =>
			index === 0 || index === last ? margin(piece) : letter(piece, index - 1),
		)
		.join('')
}

// A stage's letters and margins in the look's color: the bar inverts both, lit leaves the margins drawn.
function held(look: NoticeLook, stage: Stage): readonly [Letter, Margin] {
	if (stage === 'lit') return [(piece) => lit(look, piece.text), as_drawn]

	return [(piece) => bar(look, piece.text), (piece) => bar(look, BLANK.repeat(piece.width))]
}

// The letters while they lock: those left of the step and the blanks lit, the rest spinning.
function tracing(
	pieces: ReadonlyArray<StyledPiece>,
	step: number,
	look: NoticeLook,
	random: Random,
): string {
	function letter(piece: StyledPiece, index: number): string {
		return index < step || is_blank(piece) ? lit(look, piece.text) : spun(piece, random)
	}

	return framed(pieces, letter, as_drawn)
}

// The notice's letters: the traced text's columns less its margins.
function length_of(text: string): number {
	return run_board_cut_styled.styled_pieces(text).length - MARGINS
}

// `text` — the notice and its margins — `since_ms` after it began, as wide as it is drawn: the rain while
// a rain look's letters lock (a typed look's arrival is the frame's own, so `text`), then the stage.
function traced(text: string, since_ms: number, look: NoticeLook, random: Random): string {
	const pieces = run_board_cut_styled.styled_pieces(text)
	const length = pieces.length - MARGINS

	if (length < 1) return text

	const step = Math.floor(since_ms / LETTER_MS)

	if (step >= length) return framed(pieces, ...held(look, stage_of(since_ms - length * LETTER_MS)))

	return look.is_rain ? tracing(pieces, step, look, random) : text
}

// Whether the trace draws the notice `since_ms` after it began: a rain look from the start, a typed one
// once the theme has typed its `length` letters.
function is_drawn(since_ms: number, length: number, look: NoticeLook): boolean {
	return look.is_rain || since_ms >= length * LETTER_MS
}

// joshuafolkken/kit#8657: how long after it began the notice of `length` letters next changes its look,
// `since_ms` after it began — while they arrive, the rain's next letter step or the typed letters' end,
// the stage's end after; none once it holds lit.
function change_after(since_ms: number, length: number, look: NoticeLook): number {
	const lock_ms = length * LETTER_MS

	if (since_ms < lock_ms) {
		return look.is_rain ? (Math.floor(since_ms / LETTER_MS) + 1) * LETTER_MS : lock_ms
	}

	const until_ms = STAGES.find(([stage_ms]) => since_ms - lock_ms < stage_ms)?.[0]

	return until_ms === undefined ? Infinity : lock_ms + until_ms
}

// The notice slot a frame draws: its key, and whether a standing state holds it in place of a notice.
interface NoticeSlot {
	key: string | undefined
	is_standing: boolean
}

interface NoticeTrace {
	key: string
	start_ms: number
}

function is_notice(slot: NoticeSlot): slot is NoticeSlot & { key: string } {
	return slot.key !== undefined && slot.key !== NONE_KEY && !slot.is_standing
}

// The trace a frame's notice carries — the last frame's while its key holds, else one starting now, as
// `run-board-type-rows.ts` → `start_of` starts a row; none for the empty slot or a standing state.
function trace_of(
	slot: NoticeSlot,
	last: NoticeTrace | undefined,
	now_ms: number,
): NoticeTrace | undefined {
	if (!is_notice(slot)) return undefined

	return last?.key === slot.key ? last : { key: slot.key, start_ms: now_ms }
}

const run_board_notice_trace = {
	LETTER_MS,
	PAIR_MS,
	TRACE_BLINK_MS,
	TRACE_GAP_MS,
	change_after,
	is_drawn,
	length_of,
	trace_of,
	traced,
}

export { run_board_notice_trace }
export type { NoticeLook, NoticeSlot, NoticeTrace }
