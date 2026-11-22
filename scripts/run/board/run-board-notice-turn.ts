import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_fit } from './run-board-fit'
import { run_board_header_notice, type NoticeFields } from './run-board-header-notice'
import type { Icons } from './run-board-icons'
import { run_board_notice_trace, type NoticeTrace } from './run-board-notice-trace'
import type { Random } from './run-board-rain'
import { run_board_standing } from './run-board-standing'
import { run_board_theme } from './run-board-theme'
import type { Theme } from './run-board-theme-defs'
import type { KeyedLine } from './run-board-type-rows'

// joshuafolkken/kit#8657: the matrix board's header notice traced between redraws. Each frame carries
// the notice's trace (`run-board-notice-trace.ts`) on from the last — none starts on the base frame, so a
// notice already there when the board opens draws as it is — and, while it traces, where the frame drew
// the notice with a column each side, as the theme drew it. The spin rewrites those columns at every
// turn past the theme, and the change flash leaves them to it.

const CSI = '\u{1B}['
const { RESET } = run_board_cut_styled
const BLANK = ' '

// Where a frame drew the notice: its row, the column of the margin before it (1-based) and its text with
// a margin each side, as the theme drew it.
interface NoticePlace {
	row: number
	column: number
	text: string
}

// The notice's trace carried from frame to frame, and where this frame drew it while it traces.
interface NoticeTurn {
	trace: NoticeTrace
	place?: NoticePlace | undefined
}

type Placed = NoticeTurn & { place: NoticePlace }

// What a frame gives the notice's turn: its keyed lines, the header the notice was drawn from, whether
// it is the base the rows type against, its moment, its theme and the pane's columns.
interface NoticeFrame {
	keyed: ReadonlyArray<KeyedLine>
	header: NoticeFields
	is_base: boolean
	now_ms: number
	look: { theme: Theme | undefined; icons?: Icons | undefined }
	columns: number
}

function drawn_width(text: string, look: NoticeFrame['look']): number {
	return run_board_fit.width_of(run_board_theme.restyle(look.theme, text, look.icons))
}

// The notice's columns on its line as the theme draws it, a margin each side; none where the line has
// no column before it or the pane none after it.
function place_of(line: KeyedLine, frame: NoticeFrame): NoticePlace | undefined {
	const { cut_styled, tail_styled } = run_board_cut_styled
	const before = drawn_width(cut_styled(line.text, line.prefix_columns), frame.look)
	const end = drawn_width(line.text, frame.look) + 1

	if (before < 1 || end > frame.columns) return undefined
	const { theme, icons } = frame.look
	const drawn = run_board_theme.restyle(theme, `${line.text}${line.suffix ?? ''}`, icons)
	const text = cut_styled(tail_styled(`${drawn}${BLANK}`, before - 1), end - before + 1)

	return { row: line.row, column: before, text }
}

function since_of(turn: NoticeTurn, at_ms: number): number {
	return at_ms - turn.trace.start_ms
}

function is_tracing(turn: NoticeTurn, place: NoticePlace, at_ms: number): boolean {
	return run_board_notice_trace.is_tracing(
		since_of(turn, at_ms),
		run_board_notice_trace.length_of(place.text),
	)
}

// The place a traced notice keeps until the next frame: this frame's, while the trace runs at it.
function placed(turn: NoticeTurn, frame: NoticeFrame): NoticeTurn {
	const line = frame.keyed.find((keyed) => keyed.key === turn.trace.key)
	const place = line === undefined ? undefined : place_of(line, frame)

	if (place === undefined || !is_tracing(turn, place, frame.now_ms)) return turn

	return { ...turn, place }
}

// The notice's turn this frame: the last trace carried while its key holds, a new one from now on a new
// notice — one on the base frame never runs — and none for the empty slot or a standing state.
function turn_of(last: NoticeTurn | undefined, frame: NoticeFrame): NoticeTurn | undefined {
	const slot = {
		key: run_board_header_notice.key_of(frame.header),
		is_standing: run_board_standing.slot_of(frame.header) !== undefined,
	}
	const start_ms = frame.is_base ? -Infinity : frame.now_ms
	const trace = run_board_notice_trace.trace_of(slot, last?.trace, start_ms)

	return trace === undefined ? undefined : placed({ trace }, frame)
}

function is_placed(turn: NoticeTurn | undefined): turn is Placed {
	return turn?.place !== undefined
}

// The moment after `now_ms` the placed notice next changes its look; never where none is placed.
function wake_after(turn: NoticeTurn | undefined, now_ms: number): number {
	if (!is_placed(turn)) return Infinity
	const length = run_board_notice_trace.length_of(turn.place.text)

	return turn.trace.start_ms + run_board_notice_trace.change_after(since_of(turn, now_ms), length)
}

// The placed notice drawn as traced at `at_ms`, from the turn after the last one at `last_ms` — none
// once the trace was over at the last turn.
function notice_bytes(
	turn: NoticeTurn | undefined,
	at_ms: number,
	last_ms: number | undefined,
	random: Random = Math.random,
): string {
	if (!is_placed(turn) || !is_tracing(turn, turn.place, last_ms ?? at_ms)) return ''
	const { row, column, text } = turn.place
	const traced = run_board_notice_trace.traced(text, since_of(turn, at_ms), random)

	return `${CSI}${String(row)};${String(column)}H${traced}${RESET}`
}

// Whether `cell` is one of the placed notice's columns, which the spin writes and no flash restores.
function covers(place: NoticePlace | undefined, cell: { row: number; column: number }): boolean {
	if (place?.row !== cell.row) return false
	const end = place.column + run_board_fit.width_of(place.text)

	return cell.column >= place.column && cell.column < end
}

const run_board_notice_turn = { covers, is_placed, notice_bytes, turn_of, wake_after }

export { run_board_notice_turn }
export type { NoticePlace, NoticeTurn }
