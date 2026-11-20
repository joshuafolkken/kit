import { describe, expect, it } from 'vitest'
import { run_board_row_key } from './run-board-row-key'
import { run_board_spin } from './run-board-spin'
import { run_board_theme_defs } from './run-board-theme-defs'
import {
	run_board_type_rows,
	type KeyedLine,
	type Typing,
	type TypingFrame,
} from './run-board-type-rows'
import { run_board_typing } from './run-board-typing'

// joshuafolkken/kit#8003: the rows a live board in a theme types as they appear after its base frame,
// a letter at a time at the opening line's pace, a block after the last letter until the row is out.

const { NO_TYPING, next, type_bytes, typed_lines } = run_board_type_rows
const LETTER_MS = run_board_theme_defs.THEME_DEFS.wargames.intro.letter_ms
const { CURSOR } = run_board_typing
const ESC = '\u{1B}'
const RESET = `${ESC}[0m`
const START = Date.parse('2026-11-19T09:00:00.000Z')
const SECOND = 1000
const ROW = 'x'.repeat(100)

function line_of(key: string, index: number, text = ROW, prefix_columns = 0): KeyedLine {
	return { key, index, row: index + 1, text, prefix_columns }
}

// joshuafolkken/kit#8103: the header's now line, its time drawn whole before the words that type.
const NOW_PREFIX = 'KIT  ─  5″  > '
const WORDS = '#8093 · WRITE'

function now_of(words: string, prefix = NOW_PREFIX): KeyedLine {
	return line_of(`now:${words}`, 2, `${prefix}${words}`, prefix.length)
}

// A frame drawing `keyed`, its layout holding those rows and the `hidden` ones a fold or the fit cut.
function frame_of(
	keyed: ReadonlyArray<KeyedLine>,
	hidden: ReadonlyArray<string> = [],
): TypingFrame {
	return { keyed, known: new Set([...keyed.map((line) => line.key), ...hidden]) }
}

// The typing after a base frame of `base`, then a frame of `drawn`.
function after_base(base: TypingFrame, drawn: ReadonlyArray<KeyedLine>): Typing {
	return next(next(NO_TYPING, base, START, true), frame_of(drawn), START + SECOND, true)
}

// The keyed rows a frame of `lines` leaves on a pane two rows tall.
function on_screen(lines: ReadonlyArray<string>): Array<KeyedLine> {
	return run_board_spin.spun(lines, '⠋', { rows: 2, columns: 80 }).keyed
}

function keys_of(typing: Typing): Array<string> {
	return typing.lines.map((line) => line.key)
}

describe('run_board_type_rows.next', () => {
	it('types nothing on the base frame, and only the keys a later frame draws anew', () => {
		const lane = line_of('lanes:1', 0)
		const base = next(NO_TYPING, frame_of([lane]), START, true)
		const typing = after_base(frame_of([lane]), [lane, line_of('queued:2', 1)])

		expect(base.lines).toStrictEqual([])
		expect(keys_of(typing)).toStrictEqual(['queued:2'])
	})

	it('types no row a fold or the pane’s fit hid when it shows again, its key held all along', () => {
		const lane = line_of('lanes:1', 0)
		const typing = after_base(frame_of([lane], ['done:7']), [lane, line_of('done:7', 1)])

		expect(typing.lines).toStrictEqual([])
	})

	it('types a row that moved from the lanes to done again in done, not a lane row whose time alone changed', () => {
		const base = frame_of([
			line_of('lanes:7', 0, `⠋ 7 1′00″ ${ROW}`),
			line_of('lanes:8', 1, `⠋ 8 1′00″ ${ROW}`),
		])
		const drawn = [line_of('lanes:8', 0, `⠙ 8 1′01″ ${ROW}`), line_of('done:7', 1)]

		expect(keys_of(after_base(base, drawn))).toStrictEqual(['done:7'])
	})

	it('types none and keeps no base where typing is off', () => {
		const off = next(NO_TYPING, frame_of([]), START, false)
		const typing = next(off, frame_of([line_of('done:7', 0)]), START, false)

		expect(typing).toStrictEqual(NO_TYPING)
	})

	it('goes on from where a row started across a redraw, and lets a row go once typed through', () => {
		const row = frame_of([line_of('done:7', 0, 'x'.repeat(30))])
		const typing = after_base(frame_of([]), row.keyed)
		const later = next(typing, row, START + 2 * SECOND, true)
		const through = next(later, row, START + 3 * SECOND, true)

		expect(later.lines[0]?.start_ms).toBe(START + SECOND)
		expect(through.lines).toStrictEqual([])
	})
})

// joshuafolkken/kit#8250: the trill reads whether a row is typing by the clock.
describe('run_board_type_rows.is_typing', () => {
	it('is true while a row is still typing and false once it is typed through', () => {
		const typing = after_base(frame_of([line_of('#1', 0)]), [line_of('#1', 0), line_of('#2', 1)])
		const typed_ms = START + SECOND + ROW.length * LETTER_MS

		expect(run_board_type_rows.is_typing(typing, START + SECOND)).toBe(true)
		expect(run_board_type_rows.is_typing(typing, typed_ms)).toBe(false)
	})

	it('is false with no row typing', () => {
		expect(run_board_type_rows.is_typing(NO_TYPING, START)).toBe(false)
	})
})

// joshuafolkken/kit#8375: the rules' lock starts once the row that types through last is done.
describe('run_board_type_rows.done_ms', () => {
	it('is the moment the row typing through last is done, with rows typing together', () => {
		const short = line_of('#2', 1, 'x'.repeat(10))
		const typing = after_base(frame_of([line_of('#1', 0)]), [
			line_of('#1', 0),
			short,
			line_of('#3', 2),
		])

		expect(run_board_type_rows.done_ms(typing)).toBe(START + SECOND + (ROW.length - 1) * LETTER_MS)
	})

	it('is none before any row has typed', () => {
		expect(run_board_type_rows.done_ms(NO_TYPING)).toBeUndefined()
	})

	it('is kept across the redraw that drops the rows typed through', () => {
		const typing = after_base(frame_of([line_of('#1', 0)]), [line_of('#1', 0), line_of('#2', 1)])
		const later = next(
			typing,
			frame_of([line_of('#1', 0), line_of('#2', 1)]),
			START + 9 * SECOND,
			true,
		)

		expect(later.lines).toStrictEqual([])
		expect(run_board_type_rows.done_ms(later)).toBe(run_board_type_rows.done_ms(typing))
	})
})

// joshuafolkken/kit#8376: the lamp strips fill with the row that types through last.
describe('run_board_type_rows.progress', () => {
	it('is the share the row typing through last has typed, with rows typing together', () => {
		const short = line_of('#2', 1, 'x'.repeat(10))
		const typing = after_base(frame_of([]), [short, line_of('#3', 2)])
		const at_ms = START + SECOND + (ROW.length / 2 - 1) * LETTER_MS

		expect(run_board_type_rows.progress(typing, at_ms)).toBe(1 / 2)
	})

	it('is all once no row types', () => {
		expect(run_board_type_rows.progress(NO_TYPING, START)).toBe(1)
	})
})

describe('run_board_type_rows — what is written', () => {
	it('draws a row on a redraw as typed so far with the block after it, the rest of the frame as drawn', () => {
		const typing = after_base(frame_of([]), [line_of('done:7', 1)])
		const later = next(typing, frame_of(typing.lines), START + SECOND + 10 * LETTER_MS, true)
		const lines = typed_lines(['head', ROW, 'foot'], later, START + SECOND + 10 * LETTER_MS)

		expect(lines).toStrictEqual(['head', `${'x'.repeat(11)}${RESET}${CURSOR}`, 'foot'])
	})

	it('types two rows that appear together side by side, each with its own block, at its own row', () => {
		const typing = after_base(frame_of([]), [line_of('done:7', 2), line_of('done:9', 4)])
		const bytes = type_bytes(typing, START + SECOND + LETTER_MS)

		expect(bytes).toBe(
			`${ESC}[3;1Hxx${RESET}${CURSOR}${ESC}[K${ESC}[5;1Hxx${RESET}${CURSOR}${ESC}[K`,
		)
	})

	it('writes a row whole, with no block, once it is typed through', () => {
		const typing = after_base(frame_of([]), [line_of('done:7', 0, ' a b')])
		const bytes = type_bytes(typing, START + SECOND + 4 * LETTER_MS)

		expect(bytes).toBe(`${ESC}[1;1H a b${ESC}[K`)
		expect(typed_lines([' a b'], typing, START + SECOND + 4 * LETTER_MS)).toStrictEqual([' a b'])
		expect(bytes).not.toContain(CURSOR)
	})

	it('writes nothing for a row the frame was cut to the terminal’s rows without', () => {
		const base = frame_of(on_screen(['head', 'row']))
		const drawn = on_screen(['head', 'row', run_board_row_key.keyed('done', 7, ROW)])
		const typing = after_base(base, drawn)

		expect(typing.lines).toStrictEqual([])
		expect(type_bytes(typing, START + SECOND + LETTER_MS)).toBe('')
	})
})

describe('run_board_type_rows — the header’s now line (joshuafolkken/kit#8103)', () => {
	it('types the now line’s new words after its prefix, the prefix drawn whole', () => {
		const typing = after_base(frame_of([now_of('#1 · READ')]), [now_of(WORDS)])
		const at_ms = START + SECOND + 2 * LETTER_MS

		expect(keys_of(typing)).toStrictEqual([`now:${WORDS}`])
		expect(type_bytes(typing, at_ms)).toBe(`${ESC}[3;1H${NOW_PREFIX}#80${RESET}${CURSOR}${ESC}[K`)
	})

	it('writes the now line whole once its words are typed through', () => {
		const typing = after_base(frame_of([]), [now_of(WORDS)])
		const at_ms = START + SECOND + WORDS.length * LETTER_MS

		expect(typed_lines(['a', 'b', `${NOW_PREFIX}${WORDS}`], typing, at_ms)).toStrictEqual([
			'a',
			'b',
			`${NOW_PREFIX}${WORDS}`,
		])
	})

	it('types not the now line whose time alone changed, nor its base frame', () => {
		const base = next(NO_TYPING, frame_of([now_of(WORDS)]), START, true)
		const typing = after_base(frame_of([now_of(WORDS)]), [now_of(WORDS, 'KIT  ─  6″  > ')])

		expect(base.lines).toStrictEqual([])
		expect(typing.lines).toStrictEqual([])
	})

	it('drops words still typing for the next ones, typed from their first letter', () => {
		const typing = after_base(frame_of([]), [now_of(WORDS)])
		const changed_ms = START + SECOND + 3 * LETTER_MS
		const changed = next(typing, frame_of([now_of('#9 · SHIP')]), changed_ms, true)

		expect(keys_of(changed)).toStrictEqual(['now:#9 · SHIP'])
		expect(changed.lines[0]?.start_ms).toBe(changed_ms)
	})
})
