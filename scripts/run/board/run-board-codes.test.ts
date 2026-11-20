import { stripVTControlCharacters } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_codes, type RuleCell } from './run-board-codes'
import type { Lamp } from './run-board-lamp-spots'
import { run_board_spin } from './run-board-spin'
import type { Typing } from './run-board-type-rows'

// joshuafolkken/kit#8375: a wargames live board's section rules run launch codes while a row types, then
// a lock crosses them left to right and turns them back into the rule.

const { CODE, CODE_MS, code_bytes, is_coding, locked_at, rule_cells } = run_board_codes
const START = Date.parse('2026-11-20T09:00:00.000Z')
const LETTER_MS = 50
const TEXT = 'x'.repeat(10)
// The row types through on its tenth letter.
const DONE = START + (TEXT.length - 1) * LETTER_MS
const RULE_LINE = '── LANES ── CPU ──'
const CELLS: ReadonlyArray<RuleCell> = rule_cells(['KIT', RULE_LINE, '     8336'], [1, 2, 3], 80)
const WHITE = '235;255;252'
// eslint-disable-next-line no-control-regex -- a cell is written after a cursor move
const MOVE = /\u{1B}\[(\d+);(\d+)H/u

function typing_at(start_ms: number): Typing {
	return {
		seen: new Set(),
		lines: [{ key: '#1', index: 0, row: 4, text: TEXT, prefix_columns: 0, start_ms }],
	}
}

// Each written cell's column and the bytes written in it.
function written(bytes: string): Map<number, string> {
	const parts = bytes.split(MOVE)
	const cells = new Map<number, string>()

	for (let index = 1; index + 2 < parts.length; index += 3) {
		cells.set(Number(parts[index + 1]), parts[index + 2] ?? '')
	}

	return cells
}

function shown(bytes: string): Map<number, string> {
	const cells = [...written(bytes)]

	return new Map(cells.map(([column, text]) => [column, stripVTControlCharacters(text)]))
}

beforeEach(() => {
	vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_codes.rule_cells', () => {
	it('takes every rule `─` past the lead, not the section name or column heading', () => {
		expect(CELLS).toStrictEqual([
			{ row: 2, column: 10 },
			{ row: 2, column: 11 },
			{ row: 2, column: 17 },
			{ row: 2, column: 18 },
		])
	})

	it.each(['▾ LANES ──', '▸ QUEUE ──', '─ LANES ──'])(
		'takes the rule past the live lead of %s',
		(line) => {
			expect(rule_cells([line], [1], 80)).toStrictEqual([
				{ row: 1, column: 9 },
				{ row: 1, column: 10 },
			])
		},
	)

	it('takes nothing from a line that is not a section rule', () => {
		expect(rule_cells(['a ── b', '   ── b', '──── b'], [1, 2, 3], 80)).toStrictEqual([])
	})
})

describe('run_board_codes.code_bytes — while a row types', () => {
	it('runs a code character from the set in every rule cell', () => {
		const cells = shown(code_bytes(typing_at(START), CELLS, START + CODE_MS, undefined))

		expect([...cells.keys()]).toStrictEqual([10, 11, 17, 18])
		for (const text of cells.values()) expect(text).toMatch(new RegExp(`^[${CODE}]$`, 'u'))
	})

	it('changes the characters every step', () => {
		const first = shown(code_bytes(typing_at(START), CELLS, START + CODE_MS, undefined))
		const next = shown(code_bytes(typing_at(START), CELLS, START + 2 * CODE_MS, undefined))

		expect([...first.values()]).not.toStrictEqual([...next.values()])
	})

	it('writes nothing with no rule cell', () => {
		expect(code_bytes(typing_at(START), [], START + CODE_MS, undefined)).toBe('')
	})
})

describe('run_board_codes.code_bytes — the lock', () => {
	it('turns the columns it passed back into the rule, its two leading cells white', () => {
		const bytes = code_bytes(typing_at(START), CELLS, DONE + 2 * CODE_MS, DONE + CODE_MS)
		const cells = written(bytes)

		expect(shown(bytes).get(10)).toBe('-')
		expect(cells.get(11)).toContain(WHITE)
		expect(cells.get(17)).not.toContain(WHITE)
	})

	it('puts the last code back into the rule on the step the lock reaches the right end', () => {
		const end_ms = locked_at(typing_at(START), CELLS) ?? 0
		const cells = shown(code_bytes(typing_at(START), CELLS, end_ms, end_ms - CODE_MS))

		expect([...cells.values()]).toStrictEqual(['-', '-'])
		expect(code_bytes(typing_at(START), CELLS, end_ms + CODE_MS, end_ms)).toBe('')
	})
})

describe('run_board_codes.locked_at', () => {
	it('is the step the lock, five columns a step, reaches the rightmost cell', () => {
		expect(locked_at(typing_at(START), CELLS)).toBe(DONE + 4 * CODE_MS)
	})

	it('is none before any row has typed', () => {
		expect(locked_at({ seen: undefined, lines: [] }, CELLS)).toBeUndefined()
	})

	it('ends the code: running before it, not from it', () => {
		const end_ms = locked_at(typing_at(START), CELLS) ?? 0

		expect(is_coding(typing_at(START), CELLS, end_ms - 1)).toBe(true)
		expect(is_coding(typing_at(START), CELLS, end_ms)).toBe(false)
	})
})

const LAMP: Lamp = { row: 6, column: 72, panel_row: 0, group: 0, lamp: 0 }

async function turns_with(lamps: ReadonlyArray<Lamp>): Promise<string> {
	let now_ms = START
	const writes: Array<string> = []
	const ports = {
		now: () => now_ms,
		write: (text: string) => {
			writes.push(text)
		},
		sleep: async (ms: number) => {
			now_ms += ms
		},
	}

	await run_board_spin.spin_to_second(
		{ spots: [], typing: typing_at(START), lamps, rules: CELLS },
		ports,
	)

	return writes.join('')
}

describe('run_board_spin.spin_to_second — the rules', () => {
	it('runs the code where the lamp panel blinks', async () => {
		expect(await turns_with([LAMP])).toContain('\u{1B}[2;10H')
	})

	it('writes no rule cell where the lamp panel is off', async () => {
		expect(await turns_with([])).not.toContain('\u{1B}[2;10H')
	})
})
