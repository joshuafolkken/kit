import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_fit } from './run-board-fit'
import { run_board_intro } from './run-board-intro'
import { run_board_typing } from './run-board-typing'

// joshuafolkken/kit#8003: a live board in a theme types each issue row that appears after its base frame
// a letter at a time, at the opening line's pace, a block after the last letter until the row is out.
// A row is known by its key — its section and number (`run-board-row-key.ts`) — so a row that moves from
// the lanes to done types again in done, and one whose times alone change types once. Each redraw draws a
// typing row as typed by then, and between redraws the row is rewritten where it is on screen. Only a
// row within one screen row types (`run-board-spin.ts`); a wider one is drawn whole.

const CSI = '\u{1B}['
const { ERASE_LINE_END, LETTER_MS } = run_board_intro

// A keyed row on screen: its key, its line in the frame, its row on screen (1-based) and its text as
// the frame draws it.
interface KeyedLine {
	key: string
	index: number
	row: number
	text: string
}

interface TypingLine extends KeyedLine {
	start_ms: number
}

// The keys the last frame drew — none before the base frame — and the rows typing.
interface Typing {
	seen: ReadonlySet<string> | undefined
	lines: ReadonlyArray<TypingLine>
}

const NO_TYPING: Typing = { seen: undefined, lines: [] }

// The columns typed by `now_ms`: one the moment a row starts, one more every letter's pause.
function columns_at(line: TypingLine, now_ms: number): number {
	return Math.floor((now_ms - line.start_ms) / LETTER_MS) + 1
}

function is_typed(line: TypingLine, now_ms: number): boolean {
	return columns_at(line, now_ms) >= run_board_fit.width_of(line.text)
}

// The row as typed by `now_ms`, its colors kept; whole, without the block, once typed through.
function shown(line: TypingLine, now_ms: number): string {
	const part = is_typed(line, now_ms)
		? line.text
		: run_board_cut_styled.cut_styled(line.text, columns_at(line, now_ms))

	return run_board_typing.typed(line.text, part)
}

// The row as it types on this frame: from now for a key the last frame did not draw, else from where it
// started; none for a row not typing or typed through.
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
// with it off none types and no base is kept.
function next(
	typing: Typing,
	keyed: ReadonlyArray<KeyedLine>,
	now_ms: number,
	is_on: boolean,
): Typing {
	if (!is_on) return NO_TYPING

	const seen = new Set(keyed.map((line) => line.key))
	const last = typing.seen

	if (last === undefined) return { seen, lines: [] }

	const lines = keyed
		.map((line) => typing_of(line, last, typing.lines, now_ms))
		.filter((line) => line !== undefined)

	return { seen, lines }
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

const run_board_type_rows = { NO_TYPING, next, type_bytes, typed_lines }

export { run_board_type_rows }
export type { KeyedLine, Typing }
