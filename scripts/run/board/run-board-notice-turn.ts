import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_fit } from './run-board-fit'
import { run_board_header_notice, type NoticeFields } from './run-board-header-notice'
import type { Icons } from './run-board-icons'
import { run_board_notice_trace, type NoticeLook, type NoticeTrace } from './run-board-notice-trace'
import type { Random } from './run-board-rain'
import { run_board_standing } from './run-board-standing'
import { run_board_theme } from './run-board-theme'
import { run_board_theme_defs, type Theme } from './run-board-theme-defs'
import type { KeyedLine } from './run-board-type-rows'

// joshuafolkken/kit#8657: the board's header notice traced between redraws. Each frame carries the
// notice's trace (`run-board-notice-trace.ts`) on from the last — none starts on the base frame, so a
// notice already there when the board opens draws as it is — and where the frame drew the notice with a
// column each side, as the theme drew it, in the theme's notice look. The spin rewrites those columns at
// every turn past the theme — a typed look's once the theme has typed them — and the change flash leaves
// them to it; the trace holds lit until the notice changes (joshuafolkken/kit#8745).

const CSI = '\u{1B}['
const { RESET } = run_board_cut_styled
const BLANK = ' '

// Where a frame drew the notice: its row, the column of the margin before it (1-based), its text with
// a margin each side, as the theme drew it, and the theme's notice look.
interface NoticePlace {
	row: number
	column: number
	text: string
	look: NoticeLook
}

// The notice's trace carried from frame to frame, and where this frame drew it.
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
// no column before it, the pane none after it or the theme no notice look.
function place_of(line: KeyedLine, frame: NoticeFrame): NoticePlace | undefined {
	const { cut_styled, tail_styled } = run_board_cut_styled
	const before = drawn_width(cut_styled(line.text, line.prefix_columns), frame.look)
	const end = drawn_width(line.text, frame.look) + 1
	const { theme, icons } = frame.look
	const look = run_board_theme_defs.live_of(theme).notice

	if (look === undefined || before < 1 || end > frame.columns) return undefined
	const drawn = run_board_theme.restyle(theme, `${line.text}${line.suffix ?? ''}`, icons)
	const text = cut_styled(tail_styled(`${drawn}${BLANK}`, before - 1), end - before + 1)

	return { row: line.row, column: before, text, look }
}

function since_of(turn: NoticeTurn, at_ms: number): number {
	return at_ms - turn.trace.start_ms
}

// The place a traced notice keeps until the next frame: this frame's, for as long as its key holds —
// none for the base frame's notice, whose trace never runs.
function placed(turn: NoticeTurn, frame: NoticeFrame): NoticeTurn {
	if (!Number.isFinite(turn.trace.start_ms)) return turn
	const line = frame.keyed.find((keyed) => keyed.key === turn.trace.key)
	const place = line === undefined ? undefined : place_of(line, frame)

	return place === undefined ? turn : { ...turn, place }
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

// The moment after `now_ms` the placed notice next changes its look; never where none is placed or once
// it holds lit.
function wake_after(turn: NoticeTurn | undefined, now_ms: number): number {
	if (!is_placed(turn)) return Infinity
	const { text, look } = turn.place
	const length = run_board_notice_trace.length_of(text)
	const after_ms = run_board_notice_trace.change_after(since_of(turn, now_ms), length, look)

	return turn.trace.start_ms + after_ms
}

// The placed notice drawn as traced at `at_ms`, from the turn after the last one at `last_ms` — none
// while a typed look's letters type at the last turn, which the theme draws.
function notice_bytes(
	turn: NoticeTurn | undefined,
	at_ms: number,
	last_ms: number | undefined,
	random: Random = Math.random,
): string {
	if (!is_placed(turn)) return ''
	const { row, column, text, look } = turn.place
	const length = run_board_notice_trace.length_of(text)

	if (!run_board_notice_trace.is_drawn(since_of(turn, last_ms ?? at_ms), length, look)) return ''
	const traced = run_board_notice_trace.traced(text, since_of(turn, at_ms), look, random)

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
