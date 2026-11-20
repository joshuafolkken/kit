import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_fit } from './run-board-fit'
import { run_board_intro } from './run-board-intro'
import { run_board_labels } from './run-board-labels'
import { run_board_spot } from './run-board-spot'
import { run_board_theme_defs } from './run-board-theme-defs'
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

interface TypingLine extends KeyedLine {
	start_ms: number
}

// The keys the last frame's layout held — none before the base frame — the rows typing, and the moment
// the last row typed through was done, kept across the redraws that drop it (joshuafolkken/kit#8375).
interface Typing {
	seen: ReadonlySet<string> | undefined
	lines: ReadonlyArray<TypingLine>
	done_ms?: number | undefined
}

// A frame's keyed rows that can type and the key of every row its layout holds.
interface TypingFrame {
	keyed: ReadonlyArray<KeyedLine>
	known: ReadonlySet<string>
}

const NO_TYPING: Typing = { seen: undefined, lines: [] }

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

// The row as typed by `now_ms`, its colors kept and its spinners at their frame of that moment; whole,
// without the block, once typed through.
function shown(line: TypingLine, now_ms: number): string {
	const part = is_typed(line, now_ms)
		? line.text
		: run_board_cut_styled.cut_styled(line.text, columns_at(line, now_ms))

	return run_board_spot.drawn(
		run_board_typing.typed(line.text, part),
		run_board_labels.spinner_of(now_ms),
	)
}

// The row as it types on this frame: from now for a key the last frame's layout did not hold, else from
// where it started; none for a row not typing or typed through.
function typing_of(
	line: KeyedLine,
	seen: ReadonlySet<string>,
	typing: ReadonlyArray<TypingLine>,
	now_ms: number,
): TypingLine | undefined {
	const start_ms = seen.has(line.key)
		? typing.find((typed) => typed.key === line.key)?.start_ms
		: now_ms

	if (start_ms === undefined) return undefined

	const typed = { ...line, start_ms }

	return is_typed(typed, now_ms) ? undefined : typed
}

// The rows typing on this frame; the first frame where typing is on is the base and types none, and
// with it off none types and no base is kept. A row is new by `known` — every key the layout holds,
// drawn or not — so one a fold or the pane's fit hid types not when it shows again.
function next(typing: Typing, frame: TypingFrame, now_ms: number, is_on: boolean): Typing {
	if (!is_on) return NO_TYPING

	const last = typing.seen

	if (last === undefined) return { seen: frame.known, lines: [] }

	const lines = frame.keyed
		.map((line) => typing_of(line, last, typing.lines, now_ms))
		.filter((line) => line !== undefined)

	return { seen: frame.known, lines, done_ms: done_ms(typing) }
}

// The frame's lines, each typing row as typed by `now_ms`.
function typed_lines(lines: ReadonlyArray<string>, typing: Typing, now_ms: number): Array<string> {
	const typing_at = new Map(typing.lines.map((line) => [line.index, line]))

	return lines.map((text, index) => {
		const line = typing_at.get(index)

		return line === undefined ? text : shown(line, now_ms)
	})
}

// Every typing row rewritten where it is on screen as typed by `now_ms`, the rest of its line erased.
function type_bytes(typing: Typing, now_ms: number): string {
	return typing.lines
		.map((line) => `${CSI}${String(line.row)};1H${shown(line, now_ms)}${ERASE_LINE_END}`)
		.join('')
}

// Whether any row is still typing at `now_ms` — by the clock, since a row typed through stays in
// `lines` until the next redraw drops it (joshuafolkken/kit#8250).
function is_typing(typing: Typing, now_ms: number): boolean {
	return typing.lines.some((line) => !is_typed(line, now_ms))
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
	next,
	progress,
	type_bytes,
	typed_lines,
}

export { run_board_type_rows }
export type { KeyedLine, Typing, TypingFrame, TypingLine }
