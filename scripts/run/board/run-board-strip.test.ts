import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { run_board_codes } from './run-board-codes'
import type { Lamp } from './run-board-lamp-spots'
import { run_board_lamps } from './run-board-lamps'
import { run_board_strip, type StripCell } from './run-board-strip'
import { run_board_theme_defs } from './run-board-theme-defs'
import type { Typing, TypingLine } from './run-board-type-rows'

const { strip_bytes, strip_cells } = run_board_strip
const { look_text } = run_board_lamps
const LETTER_MS = run_board_theme_defs.THEME_DEFS.wargames.intro.letter_ms
const START = Date.parse('2026-11-20T09:00:00.000Z')
const COLUMNS = 80
const FIRST_COLUMN = 60
const LAMP_COUNT = 8
const LETTERS = 20
const HALF = LETTERS / 2
const SAMPLES = 200
// eslint-disable-next-line no-control-regex -- a cell is written after a cursor move
const MOVE = /\u{1B}\[(\d+);(\d+)H/u
const RULE = `── THROUGHPUT ${'─'.repeat(40)}`
const LINES = ['HEAD', '', RULE, '  24H  ▇▄', ' ■ ■ ■', `── USAGE ${'─'.repeat(40)}`, ' row', RULE]
const STARTS = LINES.map((_line, index) => index + 1)
const RULES = run_board_codes.rule_cells(LINES, STARTS, COLUMNS)

function lamp_at(index: number): Lamp {
	const column = FIRST_COLUMN + index * 2

	return { row: 4, column, panel_row: 0, group: 0, lamp: index }
}

const LAMPS = Array.from({ length: LAMP_COUNT }, (_value, index) => lamp_at(index))
const STRIPS = strip_cells(LINES, STARTS, { lamps: LAMPS, rules: RULES })

function typing_line(start_ms: number, letters = LETTERS): TypingLine {
	return { key: 'a', index: 6, row: 7, text: 'x'.repeat(letters), prefix_columns: 0, start_ms }
}

function typing_of(...starts: ReadonlyArray<number>): Typing {
	return { seen: new Set(), lines: starts.map((start_ms) => typing_line(start_ms)) }
}

// A row so long it stays half typed through every sample.
function long_typing(at_ms: number): Typing {
	const letters = 100_000

	return { seen: new Set(), lines: [typing_line(at_ms - (letters / 2) * LETTER_MS, letters)] }
}

// The cell each strip column was written with, by column.
function written(bytes: string): Map<number, string> {
	const parts = bytes.split(MOVE)
	const cells = new Map<number, string>()

	for (let index = 1; index + 2 < parts.length; index += 3) {
		cells.set(Number(parts[index + 1]), parts[index + 2] ?? '')
	}

	return cells
}

function bytes_at(typing: Typing, at_ms: number, since_ms?: number): Map<number, string> {
	return written(strip_bytes({ typing, cells: RULES, strips: STRIPS }, at_ms, since_ms))
}

function column_of(index: number): number {
	return FIRST_COLUMN + index * 2
}

beforeAll(() => {
	vi.stubEnv('FORCE_COLOR', '3')
})

afterAll(() => {
	vi.unstubAllEnvs()
})

describe('run_board_strip.strip_cells', () => {
	it('puts a strip only on a blank line right above a rule, in the panel’s first row’s columns', () => {
		const rows = new Set(STRIPS.map((cell: StripCell) => cell.row))

		expect([...rows]).toStrictEqual([2])
		expect(STRIPS.map((cell) => cell.column)).toStrictEqual(LAMPS.map((lamp) => lamp.column))
		expect(STRIPS.every((cell) => cell.count === LAMP_COUNT)).toBe(true)
	})

	it('puts none where the frame has no panel', () => {
		expect(strip_cells(LINES, STARTS, { lamps: [], rules: RULES })).toStrictEqual([])
	})
})

describe('run_board_strip.strip_bytes — while a row types', () => {
	const at_ms = START + (HALF - 1) * LETTER_MS

	it('fills half the strip with the front lamp red and the rest out', () => {
		const cells = bytes_at(typing_of(START), at_ms)

		expect(cells.get(column_of(LAMP_COUNT / 2 - 1))).toBe(look_text('red'))

		for (let index = LAMP_COUNT / 2; index < LAMP_COUNT; index += 1) {
			expect(cells.get(column_of(index))).toBe(look_text('out'))
		}
	})

	it('twinkles each filled lamp yellow about eight times in ten', () => {
		const lit = Array.from({ length: SAMPLES }, (_value, step) =>
			bytes_at(long_typing(at_ms), at_ms + step * 100).get(column_of(0)),
		).filter((cell) => cell === look_text('yellow'))

		expect(lit.length / SAMPLES).toBeGreaterThan(0.6)
		expect(lit.length / SAMPLES).toBeLessThan(0.95)
	})

	it('follows the row that types through last', () => {
		const late = bytes_at(typing_of(START - HALF * LETTER_MS, START), at_ms)

		expect(late.get(column_of(LAMP_COUNT / 2 - 1))).toBe(look_text('red'))
	})
})

describe('run_board_strip.strip_bytes — the lock', () => {
	const typing = typing_of(START)
	const done_ms = START + (LETTERS - 1) * LETTER_MS
	const locked_ms = run_board_codes.locked_at(typing, RULES) ?? 0

	it('stays full while the lock crosses, the last lamp red', () => {
		const cells = bytes_at(typing, done_ms + 100)

		expect(cells.size).toBe(LAMP_COUNT)
		expect(cells.get(column_of(LAMP_COUNT - 1))).toBe(look_text('red'))
	})

	it('goes out at once, every lamp back to the blank line, when the lock is done', () => {
		const cells = bytes_at(typing, locked_ms, locked_ms - 1)

		expect([...cells.values()]).toStrictEqual(Array.from({ length: LAMP_COUNT }, () => ' '))
	})

	it('writes nothing once out, nor after a redraw while the rules run no code', () => {
		expect(bytes_at(typing, locked_ms + 100, locked_ms).size).toBe(0)
		expect(bytes_at(typing, locked_ms + 100).size).toBe(0)
	})
})
