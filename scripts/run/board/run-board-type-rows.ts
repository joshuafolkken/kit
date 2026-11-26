import { run_board_fit } from './run-board-fit'
import { run_board_theme_defs } from './run-board-theme-defs'

// joshuafolkken/kit#8003: a live board in a theme types each issue row that appears after its base frame
// a letter at a time, at the opening line's pace, until the row is out. A row is known by its key — its
// section and number (`run-board-row-key.ts`) — so a row that moves from the lanes to done types again in
// done, and one whose times alone change types once. The theme layer draws the typing
// (joshuafolkken/kit#8917, `run-board-theme-events.ts`); what is kept here is which rows type and when,
// for its events and the trill. Only a row within one screen row types (`run-board-spin.ts`).

// joshuafolkken/kit#8349: the rows type at the wargames opening's pace.
const LETTER_MS = run_board_theme_defs.THEME_DEFS.wopr.intro.letter_ms

// A keyed row on screen: its key, its line in the frame, its row on screen (1-based), its text as the
// frame draws it and the columns before its key — drawn whole, so only the rest types
// (joshuafolkken/kit#8103: the header's now line types its words, not its time), and what follows its
// end mark, drawn whole in its own columns after the text (joshuafolkken/kit#8607: the watch panel);
// a flashed row also carries its text before the theme restyled it, which its events are read from
// (joshuafolkken/kit#8470: the matrix draws 💥 as FL).
interface KeyedLine {
	key: string
	index: number
	row: number
	text: string
	prefix_columns: number
	suffix?: string | undefined
	source?: string | undefined
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
}

// A frame's keyed rows that can type, the key of every row its layout holds, and while the plan drawn
// is a saved one the keys it draws faint.
interface TypingFrame {
	keyed: ReadonlyArray<KeyedLine>
	known: ReadonlySet<string>
	faint?: ReadonlySet<string> | undefined
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

// The letters the row types: its columns past the prefix.
function letters_of(line: KeyedLine): number {
	return run_board_fit.width_of(line.text) - line.prefix_columns
}

// The first moment the row is typed through.
function typed_at(line: TypingLine): number {
	return line.start_ms + Math.max(0, letters_of(line) - 1) * LETTER_MS
}

// The moment the row that types through last is done — still ahead while one types — none before any
// row has typed.
function done_ms(typing: Typing): number | undefined {
	const typed = typing.lines.map((line) => typed_at(line))
	const latest = Math.max(typing.done_ms ?? -Infinity, ...typed)

	return Number.isFinite(latest) ? latest : undefined
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

	if (typing.seen === undefined) return { seen: frame.known, lines: [], saved }

	const landing = landing_of(typing, frame)
	const lines = frame.keyed
		.map((line) => typing_of(line, typing, landing, now_ms))
		.filter((line) => line !== undefined)
		.filter((line) => !is_typed(line, now_ms))

	return { seen: frame.known, lines, done_ms: done_ms(typing), saved }
}

// Whether any row is still typing at `now_ms` — by the clock, since a row typed through stays in
// `lines` until the next redraw drops it (joshuafolkken/kit#8250).
function is_typing(typing: Typing, now_ms: number): boolean {
	return typing.lines.some((line) => now_ms < typed_at(line))
}

// How long after `now_ms` the last row types through; 0 once none types. The trill stops itself
// then, so a redraw held up by a slow gather does not keep it ringing (joshuafolkken/kit#8523).
function left_ms(typing: Typing, now_ms: number): number {
	return Math.max(0, ...typing.lines.map((line) => typed_at(line) - now_ms))
}

const run_board_type_rows = {
	NO_TYPING,
	done_ms,
	is_typing,
	left_ms,
	next,
}

export { run_board_type_rows }
export type { KeyedLine, Typing, TypingFrame, TypingLine }
