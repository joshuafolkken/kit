import { styleText } from 'node:util'
import { run_board_cut_styled, type StyledPiece } from './run-board-cut-styled'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_labels } from './run-board-labels'
import { run_board_rain, type Random } from './run-board-rain'
import { run_board_row_key } from './run-board-row-key'

// joshuafolkken/kit#8658: the matrix board's notice trace (joshuafolkken/kit#8657's approved demo). A new
// notice's letters spin as the rain's glyphs in the head's white-green, lock from the left one per
// `LETTER_MS` in bright green, then a green inverse bar — one column past each end — is lit, off and lit
// again, and the notice stays bright a while more. Pure: the time and the random are passed in.

const LETTER_MS = 50
const TRACE_BLINK_MS = 1000
const TRACE_GAP_MS = 1000
const TRACE_BRIGHT_MS = 4000

// The notice slot's empty state (`run-board-header-notice.ts` → `NONE`) never traces.
const NONE_KEY = run_board_row_key.key_of('notice', '—')
// The traced text is the notice with the column drawn before and after it, where the bar reaches.
const MARGINS = 2
const BLANK = ' '

type Stage = 'bar' | 'bright'

// What the notice holds once its last letter locks, by how long it has held: each stage until its time.
const STAGES: ReadonlyArray<readonly [number, Stage]> = [
	[TRACE_BLINK_MS, 'bar'],
	[TRACE_BLINK_MS + TRACE_GAP_MS, 'bright'],
	[TRACE_BLINK_MS + TRACE_GAP_MS + TRACE_BLINK_MS, 'bar'],
	[TRACE_BRIGHT_MS, 'bright'],
]

const { RESET } = run_board_cut_styled
const { SHADES } = run_board_header_trace
const { painted } = run_board_labels

function hold_style(held_ms: number): Stage | undefined {
	return STAGES.find(([until_ms]) => held_ms < until_ms)?.[1]
}

function bright(text: string): string {
	return painted(SHADES.bright, text)
}

function bar(text: string): string {
	return styleText('inverse', bright(text))
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

function bar_letter(piece: StyledPiece): string {
	return bar(piece.text)
}

function bar_margin(piece: StyledPiece): string {
	return bar(BLANK.repeat(piece.width))
}

function bright_letter(piece: StyledPiece): string {
	return bright(piece.text)
}

const HELD: Readonly<Record<Stage, readonly [Letter, Margin]>> = {
	bar: [bar_letter, bar_margin],
	bright: [bright_letter, as_drawn],
}

// The letters while they lock: those left of the step and the blanks bright, the rest spinning.
function tracing(pieces: ReadonlyArray<StyledPiece>, step: number, random: Random): string {
	function letter(piece: StyledPiece, index: number): string {
		return index < step || is_blank(piece) ? bright(piece.text) : spun(piece, random)
	}

	return framed(pieces, letter, as_drawn)
}

// The notice's letters: the traced text's columns less its margins.
function length_of(text: string): number {
	return run_board_cut_styled.styled_pieces(text).length - MARGINS
}

// `text` — the notice and its margins — `since_ms` after it began, as wide as it is drawn; past the
// trace, as the frame draws it.
function traced(text: string, since_ms: number, random: Random): string {
	const pieces = run_board_cut_styled.styled_pieces(text)
	const length = pieces.length - MARGINS

	if (length < 1) return text

	const step = Math.floor(since_ms / LETTER_MS)

	if (step < length) return tracing(pieces, step, random)

	const stage = hold_style(since_ms - length * LETTER_MS)

	return stage === undefined ? text : framed(pieces, ...HELD[stage])
}

function is_tracing(since_ms: number, length: number): boolean {
	return since_ms < length * LETTER_MS + TRACE_BRIGHT_MS
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
	TRACE_BLINK_MS,
	TRACE_BRIGHT_MS,
	TRACE_GAP_MS,
	is_tracing,
	length_of,
	trace_of,
	traced,
}

export { run_board_notice_trace }
export type { NoticeSlot, NoticeTrace }
