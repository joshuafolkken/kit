import { stripVTControlCharacters } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_codes, type RuleCell } from './run-board-codes'
import { run_board_fixture } from './run-board-fixture'
import { run_board_frame_fixture } from './run-board-frame-fixture'
import type { Lamp } from './run-board-lamp-spots'
import { run_board_lamps } from './run-board-lamps'
import type { Theme } from './run-board-theme-defs'
import { run_board_tick } from './run-board-tick'
import type { Typing } from './run-board-type-rows'

// joshuafolkken/kit#8375: a wargames live board's section rules run launch codes while a row types, then
// each cell turns back into the rule on a step of its own (joshuafolkken/kit#8403).

const {
	CHANGE_MS,
	CODE,
	CODE_MS,
	CODE_PAINT,
	SCATTER_STEPS,
	code_bytes,
	is_coding,
	locked_at,
	rule_cells,
} = run_board_codes
const { LOCAL, drawn_from, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const WIDE = { rows: 60, columns: 200 }
const START = Date.parse('2026-11-20T09:00:00.000Z')
const LETTER_MS = 50
const TEXT = 'x'.repeat(10)
// The row types through on its tenth letter.
const DONE = START + (TEXT.length - 1) * LETTER_MS
const RULE_LINE = '── LANES ── CPU ──'
const CELLS: ReadonlyArray<RuleCell> = rule_cells(['KIT', RULE_LINE, '     8336'], [1, 2, 3], 80)
const WHITE = '235;255;252'
const DIM = '31;118;113'
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

function codes_at(at_ms: number): Array<string> {
	return [...shown(code_bytes(typing_at(START), CELLS, at_ms, undefined)).values()]
}

// joshuafolkken/kit#8397: the code sinks behind the typing head — slower than the lock, in the rule's dim.
describe('run_board_codes.code_bytes — the code’s pace and paint', () => {
	it('changes the code every `CHANGE_MS`, two lock steps, holding it across the step between', () => {
		expect(CHANGE_MS).toBe(2 * CODE_MS)
		expect(codes_at(START + CHANGE_MS + CODE_MS)).toStrictEqual(codes_at(START + CHANGE_MS))
		expect(codes_at(START + 2 * CHANGE_MS)).not.toStrictEqual(codes_at(START + CHANGE_MS))
	})

	it('paints the code in the rule’s dim cyan, the wargames rule paint', () => {
		const cells = written(code_bytes(typing_at(START), CELLS, START + CODE_MS, undefined))

		expect(CODE_PAINT).toStrictEqual({ rgb: DIM, named: 'dim' })
		for (const text of cells.values()) expect(text).toContain(`[38;2;${DIM}m`)
	})
})

// The step after the typing on which the cell turns back into the rule.
function back_step(cell: RuleCell): number {
	return run_board_lamps.mixed([cell.row, cell.column]) % SCATTER_STEPS
}

// The write `cooled` steps after the step the row typed through on, the last write a step before.
function cooled_write(cooled: number): string {
	const at_ms = DONE + cooled * CODE_MS

	return code_bytes(typing_at(START), CELLS, at_ms, at_ms - CODE_MS)
}

// Every write from the step the row typed through on to a step past the end.
function cooling_writes(): Array<string> {
	return Array.from({ length: SCATTER_STEPS + 2 }, (_, cooled) => cooled_write(cooled))
}

// joshuafolkken/kit#8403: once the row types through, each cell goes back to the rule on a step of its own.
describe('run_board_codes.code_bytes — the scatter', () => {
	it('writes no white cell after the typing, the rule back in the dim cyan', () => {
		const writes = cooling_writes()

		for (const bytes of writes) expect(bytes).not.toContain(WHITE)
		expect(writes.join('')).toContain(`[38;2;${DIM}m-`)
	})

	it.each(CELLS)('turns the cell at column $column back on the write past its own step', (cell) => {
		const back = back_step(cell)

		expect(shown(cooled_write(back)).get(cell.column)).toMatch(new RegExp(`^[${CODE}]$`, 'u'))
		expect(written(cooled_write(back + 1)).get(cell.column)).toContain(`[38;2;${DIM}m-`)
		expect(written(cooled_write(back + 2)).has(cell.column)).toBe(false)
	})

	it('scatters the cells over the steps, not left to right', () => {
		const steps = rule_cells([`── LANES ${RULE_LINE.repeat(6)}`], [1], 200).map((cell) =>
			back_step(cell),
		)

		expect(new Set(steps).size).toBeGreaterThan(1)
		expect(steps).not.toStrictEqual(steps.toSorted((left, right) => left - right))
	})

	it('leaves every cell on the rule by the end, and nothing to write from it', () => {
		const last = new Map(cooling_writes().flatMap((bytes) => [...shown(bytes)]))
		const end_ms = locked_at(typing_at(START)) ?? 0

		expect([...last.values()]).toStrictEqual(['-', '-', '-', '-'])
		expect(code_bytes(typing_at(START), CELLS, end_ms + CODE_MS, end_ms)).toBe('')
		expect(code_bytes(typing_at(START), CELLS, end_ms, undefined)).toBe('')
	})
})

describe('run_board_codes.locked_at', () => {
	it('is a second after the step the row typed through on', () => {
		expect(SCATTER_STEPS * CODE_MS).toBe(1000)
		expect(locked_at(typing_at(START))).toBe(DONE + SCATTER_STEPS * CODE_MS)
	})

	it('is none before any row has typed, and the rules run no code', () => {
		const untyped: Typing = { seen: undefined, lines: [] }

		expect(locked_at(untyped)).toBeUndefined()
		expect(is_coding(untyped, CELLS, START)).toBe(false)
		expect(code_bytes(untyped, CELLS, START, START - CODE_MS)).toBe('')
	})

	it.each([
		{ width: 'narrow', cells: CELLS },
		{ width: 'wide', cells: rule_cells([RULE_LINE.repeat(10)], [1], 200) },
	])(
		'ends the $width rules’ code at the same moment: running before it, not from it',
		({ cells }) => {
			const end_ms = locked_at(typing_at(START)) ?? 0

			expect(is_coding(typing_at(START), cells, end_ms - 1)).toBe(true)
			expect(is_coding(typing_at(START), cells, end_ms)).toBe(false)
		},
	)
})

const LAMP: Lamp = { row: 6, column: 72, panel_row: 0, panel_rows: 5, group: 0, lamp: 0 }

// Each write of the turns to the next second, keyed by the moment it was written at.
async function timed_turns(
	lamps: ReadonlyArray<Lamp>,
	typing: Typing = typing_at(START),
): Promise<Map<number, string>> {
	let now_ms = START
	const writes = new Map<number, string>()
	const ports = {
		now: () => now_ms,
		write: (text: string) => {
			writes.set(now_ms, `${writes.get(now_ms) ?? ''}${text}`)
		},
		sleep: async (ms: number) => {
			now_ms += ms
		},
		// joshuafolkken/kit#8826: a frame that changes no cell writes nothing, so each wake is kept too.
		time_wake: (_due_ms: number, woke_ms: number) => {
			writes.set(woke_ms, writes.get(woke_ms) ?? '')
		},
	}

	await run_board_frame_fixture.spin_to_second({ spots: [], typing, lamps, rules: CELLS }, ports)

	return writes
}

async function turns_with(lamps: ReadonlyArray<Lamp>): Promise<string> {
	const writes = await timed_turns(lamps)

	return [...writes.values()].join('')
}

describe('run_board_spin.spin_to_second — the rules', () => {
	it('runs the code where the lamp panel blinks', async () => {
		expect(await turns_with([LAMP])).toContain('\u{1B}[2;10H')
	})

	it('writes no rule cell where the lamp panel is off', async () => {
		expect(await turns_with([])).not.toContain('\u{1B}[2;10H')
	})

	// Most code steps fall between two spinner turns: only a code step writes a cell back on its own step
	// (joshuafolkken/kit#8375).
	it('wakes on every code step, not only when the spinner turns', async () => {
		const cooling: Typing = { seen: new Set(), lines: [], done_ms: START }
		const writes = await timed_turns([LAMP], cooling)
		const last = Math.max(...CELLS.map((cell) => back_step(cell))) + 1
		const steps = Array.from({ length: last }, (_, index) => START + (index + 1) * CODE_MS)

		const woke = new Set(writes.keys())

		expect(steps.filter((at_ms) => !woke.has(at_ms))).toStrictEqual([])
	})
})

// What a live redraw of a frame with section rules keeps for the turns, in `theme`.
function drawn_in(theme: Theme | undefined): ReturnType<typeof drawn_from> {
	const { ports } = harness(LOCAL, [])
	const state = { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms }
	const types_rows = theme !== undefined
	const redraw = { ports: { ...ports, types_rows, theme, size: () => WIDE }, now_ms: START }

	return drawn_from(state, LOCAL, redraw, layout_for(state, LOCAL, START))
}

function drawn_rules(theme: Theme | undefined): number {
	return drawn_in(theme).rules?.length ?? 0
}

describe('run_board_tick_draw.draw_display — the rules', () => {
	it('keeps the section rules’ cells for the turns on a wargames board', () => {
		expect(drawn_rules('wargames')).toBeGreaterThan(0)
	})

	it.each([undefined, 'matrix' as const])('keeps none in the %s theme', (theme) => {
		expect(drawn_rules(theme)).toBe(0)
	})

	// joshuafolkken/kit#8376: the lamp strips come only with the rules' code, and only where the theme's
	// `live.strip` switches them on — off in wargames by default (joshuafolkken/kit#8398;
	// `run-board-tick-draw-strip.test.ts`).
	it.each([undefined, 'matrix' as const])('keeps no lamp strip in the %s theme', (theme) => {
		expect(drawn_in(theme).strips).toStrictEqual([])
	})
})
