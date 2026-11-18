import { describe, expect, it } from 'vitest'
import { run_board_intro } from './run-board-intro'
import { run_board_row_key } from './run-board-row-key'
import { run_board_spin } from './run-board-spin'
import { run_board_type_rows, type KeyedLine, type Typing } from './run-board-type-rows'
import { run_board_typing } from './run-board-typing'

// joshuafolkken/kit#8003: the rows a live board in a theme types as they appear after its base frame,
// a letter at a time at the opening line's pace, a block after the last letter until the row is out.

const { NO_TYPING, next, type_bytes, typed_lines } = run_board_type_rows
const { LETTER_MS } = run_board_intro
const { CURSOR } = run_board_typing
const ESC = '\u{1B}'
const RESET = `${ESC}[0m`
const START = Date.parse('2026-11-19T09:00:00.000Z')
const SECOND = 1000
const ROW = 'x'.repeat(100)

function line_of(key: string, index: number, text = ROW): KeyedLine {
	return { key, index, row: index + 1, text }
}

// The typing after a base frame of `base`, then a frame of `drawn`.
function after_base(base: ReadonlyArray<KeyedLine>, drawn: ReadonlyArray<KeyedLine>): Typing {
	return next(next(NO_TYPING, base, START, true), drawn, START + SECOND, true)
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
		const base = next(NO_TYPING, [lane], START, true)
		const typing = after_base([lane], [lane, line_of('queued:2', 1)])

		expect(base.lines).toStrictEqual([])
		expect(keys_of(typing)).toStrictEqual(['queued:2'])
	})

	it('types a row that moved from the lanes to done again in done, not a lane row whose time alone changed', () => {
		const base = [
			line_of('lanes:7', 0, `⠋ 7 1′00″ ${ROW}`),
			line_of('lanes:8', 1, `⠋ 8 1′00″ ${ROW}`),
		]
		const drawn = [line_of('lanes:8', 0, `⠙ 8 1′01″ ${ROW}`), line_of('done:7', 1)]

		expect(keys_of(after_base(base, drawn))).toStrictEqual(['done:7'])
	})

	it('types none and keeps no base where typing is off', () => {
		const typing = next(next(NO_TYPING, [], START, false), [line_of('done:7', 0)], START, false)

		expect(typing).toStrictEqual(NO_TYPING)
	})

	it('goes on from where a row started across a redraw, and lets a row go once typed through', () => {
		const row = [line_of('done:7', 0, 'x'.repeat(30))]
		const typing = after_base([], row)
		const later = next(typing, row, START + 2 * SECOND, true)
		const through = next(later, row, START + 3 * SECOND, true)

		expect(later.lines[0]?.start_ms).toBe(START + SECOND)
		expect(through.lines).toStrictEqual([])
	})
})

describe('run_board_type_rows — what is written', () => {
	it('draws a row on a redraw as typed so far with the block after it, the rest of the frame as drawn', () => {
		const typing = after_base([], [line_of('done:7', 1)])
		const later = next(typing, [line_of('done:7', 1)], START + SECOND + 10 * LETTER_MS, true)
		const lines = typed_lines(['head', ROW, 'foot'], later, START + SECOND + 10 * LETTER_MS)

		expect(lines).toStrictEqual(['head', `${'x'.repeat(11)}${RESET}${CURSOR}`, 'foot'])
	})

	it('types two rows that appear together side by side, each with its own block, at its own row', () => {
		const typing = after_base([], [line_of('done:7', 2), line_of('done:9', 4)])
		const bytes = type_bytes(typing, START + SECOND + LETTER_MS)

		expect(bytes).toBe(
			`${ESC}[3;1Hxx${RESET}${CURSOR}${ESC}[K${ESC}[5;1Hxx${RESET}${CURSOR}${ESC}[K`,
		)
	})

	it('writes a row whole, with no block, once it is typed through', () => {
		const typing = after_base([], [line_of('done:7', 0, ' a b')])
		const bytes = type_bytes(typing, START + SECOND + 4 * LETTER_MS)

		expect(bytes).toBe(`${ESC}[1;1H a b${ESC}[K`)
		expect(typed_lines([' a b'], typing, START + SECOND + 4 * LETTER_MS)).toStrictEqual([' a b'])
		expect(bytes).not.toContain(CURSOR)
	})

	it('writes nothing for a row the frame was cut to the terminal’s rows without', () => {
		const base = on_screen(['head', 'row'])
		const drawn = on_screen(['head', 'row', run_board_row_key.keyed('done', 7, ROW)])
		const typing = after_base(base, drawn)

		expect(typing.lines).toStrictEqual([])
		expect(type_bytes(typing, START + SECOND + LETTER_MS)).toBe('')
	})
})
