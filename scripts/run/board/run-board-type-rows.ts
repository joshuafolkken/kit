import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_decode } from './run-board-decode'
import { run_board_fit } from './run-board-fit'
import { run_board_intro } from './run-board-intro'
import { run_board_labels } from './run-board-labels'
import { run_board_spot } from './run-board-spot'
import { run_board_theme_defs } from './run-board-theme-defs'
import { run_board_type_glow } from './run-board-type-glow'
import { run_board_typing } from './run-board-typing'

// joshuafolkken/kit#8003: a live board in a theme types each issue row that appears after its base frame
// a letter at a time, at the opening line's pace, a block after the last letter until the row is out.
// A row is known by its key — its section and number (`run-board-row-key.ts`) — so a row that moves from
// the lanes to done types again in done, and one whose times alone change types once. Each redraw draws a
// typing row as typed by then, and between redraws the row is rewritten where it is on screen. Only a
// row within one screen row types (`run-board-spin.ts`); a wider one is drawn whole.

const CSI = '\u{1B}['
const { ERASE_LINE_END } = run_board_intro
// joshuafolkken/kit#8349: the rows type at the wargames intro's pace; joshuafolkken/kit#8360 picks it
// per theme.
const LETTER_MS = run_board_theme_defs.THEME_DEFS.wargames.intro.letter_ms

// A keyed row on screen: its key, its line in the frame, its row on screen (1-based), its text as the
// frame draws it and the columns before its key — drawn whole, so only the rest types
// (joshuafolkken/kit#8103: the header's now line types its words, not its time).
interface KeyedLine {
	key: string
	index: number
	row: number
	text: string
	prefix_columns: number
}

// joshuafolkken/kit#8457: a row typing over the saved frame's line of its key carries that line, drawn
// as it was right of the block until the row is typed through.
interface TypingLine extends KeyedLine {
	start_ms: number
	under?: string | undefined
}

// The keys the last frame's layout held — none before the base frame — the rows typing, the moment the
// last row typed through was done, kept across the redraws that drop it (joshuafolkken/kit#8375), and
// the saved frame's faint lines by key while the plan drawn is a saved one (joshuafolkken/kit#8457).
interface Typing {
	seen: ReadonlySet<string> | undefined
	lines: ReadonlyArray<TypingLine>
	done_ms?: number | undefined
	saved?: ReadonlyMap<string, string> | undefined
	is_decoding?: boolean | undefined
}

// A frame's keyed rows that can type, the key of every row its layout holds, while the plan drawn is a
// saved one the keys it draws faint, and whether its rows decode rather than type
// (`run-board-decode.ts`; joshuafolkken/kit#8356).
interface TypingFrame {
	keyed: ReadonlyArray<KeyedLine>
	known: ReadonlySet<string>
	faint?: ReadonlySet<string> | undefined
	is_decoding?: boolean | undefined
}

// A stretch a row types over, `to_ms` the first moment it is typed through.
interface TypingSpan {
	from_ms: number
	to_ms: number
}

// Where a row starts typing and the saved line it types over, if any.
type TypingStart = Pick<TypingLine, 'start_ms' | 'under'>

const NO_TYPING: Typing = { seen: undefined, lines: [] }
const NO_SAVED: ReadonlyMap<string, string> = new Map()

// The columns drawn by `now_ms`: the prefix, then one typed the moment a row starts and one more every
// letter's pause.
function columns_at(line: TypingLine, now_ms: number): number {
	return line.prefix_columns + Math.floor((now_ms - line.start_ms) / LETTER_MS) + 1
}

function is_typed(line: TypingLine, now_ms: number): boolean {
	return columns_at(line, now_ms) >= run_board_fit.width_of(line.text)
}

// The first moment the row is typed through.
function typed_at(line: TypingLine): number {
	const letters = run_board_fit.width_of(line.text) - line.prefix_columns - 1

	return line.start_ms + Math.max(0, letters) * LETTER_MS
}

// The moment the row that types through last is done — still ahead while one types — none before any
// row has typed.
function done_ms(typing: Typing): number | undefined {
	const typed = typing.lines.map((line) => typed_at(line))
	const latest = Math.max(typing.done_ms ?? -Infinity, ...typed)

	return Number.isFinite(latest) ? latest : undefined
}

// The saved line right of the block while the row types over one; nothing once typed through, so the
// part past a shorter live row goes with it.
function under_of(line: TypingLine, now_ms: number): string {
	if (line.under === undefined || is_typed(line, now_ms)) return ''

	return run_board_cut_styled.tail_styled(line.under, columns_at(line, now_ms) + 1)
}

// The row typed by `now_ms`, the block after it, the saved line it types over right of the block.
function typed_text(line: TypingLine, now_ms: number): string {
	const part = is_typed(line, now_ms)
		? line.text
		: run_board_cut_styled.cut_styled(line.text, columns_at(line, now_ms))

	return `${run_board_typing.typed(line.text, part)}${under_of(line, now_ms)}`
}

// Whether the row glows where the rows decode (`run-board-type-glow.ts`; joshuafolkken/kit#8370).
function is_glowing(line: TypingLine, is_decoding: boolean | undefined): boolean {
	return is_decoding === true && run_board_type_glow.glows(line.key)
}

// The glowing row as it glows by `now_ms`, the saved line it types over right of the block.
function glowing_text(line: TypingLine, now_ms: number): string {
	const at = {
		prefix_columns: line.prefix_columns,
		columns: columns_at(line, now_ms),
		since_typed_ms: now_ms - typed_at(line),
	}

	return `${run_board_type_glow.glowed(line.text, at)}${under_of(line, now_ms)}`
}

// The row as typed — or, where the rows decode, resolved (joshuafolkken/kit#8356) unless it glows — by
// `now_ms`, its colors kept; whole, without the block, once through.
function text_of(line: TypingLine, now_ms: number, is_decoding: boolean | undefined): string {
	if (is_glowing(line, is_decoding)) return glowing_text(line, now_ms)
	if (is_decoding === true) return run_board_decode.decoded(line.text, columns_at(line, now_ms))

	return typed_text(line, now_ms)
}

// The row as `text_of` draws it, its spinners at their frame of that moment.
function shown(line: TypingLine, now_ms: number, is_decoding: boolean | undefined): string {
	return run_board_spot.drawn(
		text_of(line, now_ms, is_decoding),
		run_board_labels.spinner_of(now_ms),
	)
}

// Whether the row is still drawn as it types on this frame: until typed through, or while a glowing row
// still glows after it.
function is_drawn(line: TypingLine, now_ms: number, is_decoding: boolean | undefined): boolean {
	if (!is_typed(line, now_ms)) return true

	return is_glowing(line, is_decoding) && run_board_type_glow.is_lit(now_ms - typed_at(line))
}

// Where the row starts on this frame: now over its saved line on the frame the live plan lands on, now
// for a key the last frame's layout did not hold, else where it started; none for a row not typing.
function start_of(
	line: KeyedLine,
	last: Typing,
	landing: ReadonlyMap<string, string>,
	now_ms: number,
): TypingStart | undefined {
	const under = landing.get(line.key)

	if (under !== undefined) return { start_ms: now_ms, under }
	if (last.seen?.has(line.key) !== true) return { start_ms: now_ms }

	const typed = last.lines.find((typing) => typing.key === line.key)

	return typed === undefined ? undefined : { start_ms: typed.start_ms, under: typed.under }
}

// The row as it types on this frame, typed through or not; none for a row not typing.
function typing_of(
	line: KeyedLine,
	last: Typing,
	landing: ReadonlyMap<string, string>,
	now_ms: number,
): TypingLine | undefined {
	const start = start_of(line, last, landing, now_ms)

	return start === undefined ? undefined : { ...line, ...start }
}

// The faint lines of a frame drawn from a saved plan, by key; none on a live frame.
function saved_of(frame: TypingFrame): ReadonlyMap<string, string> | undefined {
	const { faint } = frame

	if (faint === undefined) return undefined

	return new Map(
		frame.keyed.filter((line) => faint.has(line.key)).map((line) => [line.key, line.text]),
	)
}

// The first live frame after a saved one types every faint line over its saved text at once.
function landing_of(typing: Typing, frame: TypingFrame): ReadonlyMap<string, string> {
	return frame.faint === undefined ? (typing.saved ?? NO_SAVED) : NO_SAVED
}

// The rows typing on this frame; the first frame where typing is on is the base and types none, and
// with it off none types and no base is kept. A row is new by `known` — every key the layout holds,
// drawn or not — so one a fold or the pane's fit hid types not when it shows again.
function next(typing: Typing, frame: TypingFrame, now_ms: number, is_on: boolean): Typing {
	if (!is_on) return NO_TYPING

	const saved = saved_of(frame)

	const { is_decoding } = frame

	if (typing.seen === undefined) return { seen: frame.known, lines: [], saved, is_decoding }

	const landing = landing_of(typing, frame)
	const lines = frame.keyed
		.map((line) => typing_of(line, typing, landing, now_ms))
		.filter((line) => line !== undefined)
		.filter((line) => is_drawn(line, now_ms, is_decoding))

	return { seen: frame.known, lines, done_ms: done_ms(typing), saved, is_decoding }
}

// The frame's lines, each typing row as typed by `now_ms`.
function typed_lines(lines: ReadonlyArray<string>, typing: Typing, now_ms: number): Array<string> {
	const typing_at = new Map(typing.lines.map((line) => [line.index, line]))

	return lines.map((text, index) => {
		const line = typing_at.get(index)

		return line === undefined ? text : shown(line, now_ms, typing.is_decoding)
	})
}

// Every typing row rewritten where it is on screen as typed by `now_ms`, the rest of its line erased.
function type_bytes(typing: Typing, now_ms: number): string {
	return typing.lines
		.map(
			(line) =>
				`${CSI}${String(line.row)};1H${shown(line, now_ms, typing.is_decoding)}${ERASE_LINE_END}`,
		)
		.join('')
}

// Each typing row's span, from its start to the moment it types through: the one source of whether a row
// types, read by the lamps' burst and the matrix board's pour (joshuafolkken/kit#8369).
function spans_of(typing: Typing): Array<TypingSpan> {
	return typing.lines.map((line) => ({ from_ms: line.start_ms, to_ms: typed_at(line) }))
}

// Whether any row is still typing at `now_ms` — by the clock, since a row typed through stays in
// `lines` until the next redraw drops it (joshuafolkken/kit#8250).
function is_typing(typing: Typing, now_ms: number): boolean {
	return spans_of(typing).some((span) => now_ms < span.to_ms)
}

// How long after `now_ms` the last row types through; 0 once none types. The trill stops itself then,
// so a redraw held up by a slow gather does not keep it ringing (joshuafolkken/kit#8523).
function left_ms(typing: Typing, now_ms: number): number {
	return Math.max(0, ...typing.lines.map((line) => typed_at(line) - now_ms))
}

// The share of its letters the row that types through last has typed by `now_ms`, so every effect that
// follows the typing reads one progress (joshuafolkken/kit#8376); all once no row types.
function progress(typing: Typing, now_ms: number): number {
	const typing_now = typing.lines.filter((line) => !is_typed(line, now_ms))
	const latest = Math.max(...typing_now.map((line) => typed_at(line)))
	const last = typing_now.find((line) => typed_at(line) === latest)

	if (last === undefined) return 1
	const letters = run_board_fit.width_of(last.text) - last.prefix_columns

	return Math.min(1, (columns_at(last, now_ms) - last.prefix_columns) / letters)
}

const run_board_type_rows = {
	NO_TYPING,
	done_ms,
	is_typing,
	left_ms,
	next,
	progress,
	spans_of,
	type_bytes,
	typed_lines,
}

export { run_board_type_rows }
export type { KeyedLine, Typing, TypingFrame, TypingLine, TypingSpan }
