import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_frame_diff } from './run-board-frame-diff'
import { run_board_rain, type Random } from './run-board-rain'
import type { KeyedLine } from './run-board-type-rows'

// joshuafolkken/kit#8470: a matrix row whose run changed under it — a lane failed, the supervisor was
// replaced (`run_board_frame_diff.events`) — is drawn twice more, shifted and glitched, before it
// settles on its new content: the approved demo on joshuafolkken/kit#8353, started by the event
// rather than at a fixed time.

const { CSI, HEAD, frames_between } = run_board_frame_diff
const SHIFT = 3
const KANA_RATE = 0.25
const BURST_FRAMES = 2
const GAP_FRAMES = 3
const SECOND_BURST = BURST_FRAMES + GAP_FRAMES
const END_FRAMES = SECOND_BURST + BURST_FRAMES

interface DejaVu {
	key: string
	start_ms: number
}

interface Scene {
	lines: ReadonlyArray<KeyedLine>
	deja_vu: ReadonlyArray<DejaVu>
}

interface Piece {
	text: string
	width: number
}

function is_on(age: number): boolean {
	return age < BURST_FRAMES || (age >= SECOND_BURST && age < END_FRAMES)
}

// A drawn glyph, a quarter of them swapped for a rain glyph padded to the glyph's own width.
function glitched(piece: Piece, random: Random): string {
	if (piece.text.trim() === '' || random() >= KANA_RATE) return piece.text

	return `${run_board_rain.fresh(random)}${' '.repeat(piece.width - 1)}`
}

// The leading glyphs that fit `room` columns, a wide one never split.
function fitting(pieces: ReadonlyArray<Piece>, room: number): Array<Piece> {
	const kept: Array<Piece> = []
	let left = room

	for (const piece of pieces) {
		if (piece.width > left) break
		kept.push(piece)
		left -= piece.width
	}

	return kept
}

function width_of(pieces: ReadonlyArray<Piece>): number {
	return pieces.reduce((sum, piece) => sum + piece.width, 0)
}

// `text` plain, moved `SHIFT` columns right at its own width: what is pushed past its end is dropped.
function shifted(text: string, random: Random = Math.random): string {
	const pieces = run_board_cut_styled.styled_pieces(text).filter((piece) => piece.width > 0)
	const width = width_of(pieces)
	const kept = fitting(pieces, width - SHIFT)
	const body = kept.map((piece) => glitched(piece, random)).join('')
	const rest = Math.max(0, width - SHIFT - width_of(kept))

	return `${' '.repeat(Math.min(SHIFT, width))}${body}${' '.repeat(rest)}`
}

// The row over a burst, else the row as drawn — which restores it after each burst.
function row_bytes(line: KeyedLine, age: number, random: Random): string {
	const drawn = is_on(age) ? `${HEAD}${shifted(line.text, random)}` : line.text
	const glyphs = run_board_cut_styled.cut_styled(drawn, Infinity)

	return `${CSI}${String(line.row)};${String(line.prefix_columns + 1)}H${glyphs}`
}

// The replays still running, a row's event restarting its own; one whose row is gone ends.
function next(
	last: Scene | undefined,
	lines: ReadonlyArray<KeyedLine>,
	now_ms: number,
): Array<DejaVu> {
	const fresh = run_board_frame_diff.events(last?.lines ?? [], lines).map((line) => line.key)
	const present = new Set(lines.map((line) => line.key))
	const kept = (last?.deja_vu ?? []).filter(
		(entry) =>
			!fresh.includes(entry.key) &&
			present.has(entry.key) &&
			frames_between(entry.start_ms, now_ms) < END_FRAMES,
	)

	return [...kept, ...fresh.map((key) => ({ key, start_ms: now_ms }))]
}

function entry_bytes(scene: Scene, entry: DejaVu, now_ms: number, random: Random): string {
	const line = scene.lines.find((candidate) => candidate.key === entry.key)

	if (line === undefined) return ''

	return row_bytes(line, frames_between(entry.start_ms, now_ms), random)
}

// The replays' rows at `now_ms`; with `since`, one already restored by then writes nothing more.
function bytes(scene: Scene, now_ms: number, since?: { ms: number }, random?: Random): string {
	return scene.deja_vu
		.filter((entry) => since === undefined || frames_between(entry.start_ms, since.ms) < END_FRAMES)
		.map((entry) => entry_bytes(scene, entry, now_ms, random ?? Math.random))
		.join('')
}

const run_board_deja_vu = { END_FRAMES, bytes, is_on, next, shifted }

export { run_board_deja_vu }
export type { DejaVu }
