import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_frame_fixture } from './run-board-frame-fixture'
import { run_board_labels } from './run-board-labels'
import { run_board_row_key } from './run-board-row-key'
import { run_board_spin } from './run-board-spin'
import { run_board_spot } from './run-board-spot'
import { run_board_sweep } from './run-board-sweep'
import { run_board_type_rows } from './run-board-type-rows'

const { SWEEP_MS, sweep_bytes, sweep_index, sweep_of } = run_board_sweep
const { SPOT, TICK } = run_board_spot
const { REDRAW_MS, spun } = run_board_spin
const { cell_at, is_near, row_text, screens_of, spin_to_second } = run_board_frame_fixture
const { spinner_of } = run_board_labels
const START = Date.parse('2026-11-19T09:00:00.000Z')
const WIDE = { rows: 24, columns: 80 }
const CELLS = 20
const ESCAPE = '\u{1B}'
const DOT = '■'
const SWEEP = { row: 4, left: 8 }

describe('run_board_sweep.sweep_index', () => {
	it('moves one cell every 50 ms and starts again on the second', () => {
		expect([0, 49, 50, 999, 1000, 1049].map((ms) => sweep_index(START + ms))).toStrictEqual([
			0, 0, 1, 19, 0, 0,
		])
	})
})

describe('run_board_sweep.sweep_bytes', () => {
	it('moves to the sweep and writes all twenty cells, the dot in its cell only', () => {
		const bytes = sweep_bytes(SWEEP, START + 3 * SWEEP_MS)

		expect(bytes).toBe(`${ESCAPE}[4;8H   ${DOT}${' '.repeat(CELLS - 4)}`)
		expect(run_board_fit.width_of(DOT)).toBe(1)
	})
})

describe('run_board_sweep.sweep_of', () => {
	const MARK = { row_below: 4, column: 22, line_below: '' }

	it('ends the twenty cells five past the mark, on the empty line below it', () => {
		expect(sweep_of(MARK, WIDE)).toStrictEqual({ row: 4, left: 8 })
		expect(sweep_of({ ...MARK, column: 3 }, WIDE)).toStrictEqual({ row: 4, left: 1 })
	})

	it('places none over a line that is not empty, below the rows or past the columns', () => {
		expect(sweep_of({ ...MARK, line_below: 'x' }, WIDE)).toBeUndefined()
		expect(sweep_of({ ...MARK, line_below: undefined }, WIDE)).toBeUndefined()
		expect(sweep_of(MARK, { rows: 3, columns: 80 })).toBeUndefined()
		expect(sweep_of(MARK, { rows: 24, columns: 26 })).toBeUndefined()
	})
})

describe('run_board_spin.spun — the sweep (joshuafolkken/kit#8240)', () => {
	const LINES = ['▶ run', 'kit', `${SPOT}   16${TICK}  WRITE`, '', 'next']
	const THIRD_DRAWN = '⠋   16″  WRITE'

	it('draws the placeholder back as `″` and records the sweep under it', () => {
		const drawn = spun(LINES, '⠋', { size: WIDE })

		expect(drawn.lines[2]).toBe(THIRD_DRAWN)
		expect(drawn.sweep).toStrictEqual({ row: 4, left: 1 })
	})

	it('keeps the placeholder apart from a keyed third line’s key', () => {
		const third = `${SPOT}   16${TICK}  ${run_board_row_key.keyed('now', 'WRITE', 'WRITE')}`
		const drawn = spun(['▶ run', 'kit', third, ''], '⠋', { size: WIDE })

		expect(drawn.keyed.map(({ key }) => key)).toStrictEqual(['now:WRITE'])
		expect(drawn.lines[2]).toBe(THIRD_DRAWN)
		expect(drawn.sweep).toStrictEqual({ row: 4, left: 1 })
	})

	it('records no sweep with no placeholder or no fourth row on screen', () => {
		expect(spun(['▶ run', '', ''], '⠋', { size: WIDE }).sweep).toBeUndefined()
		expect(spun(LINES, '⠋', { size: { rows: 3, columns: 80 } }).sweep).toBeUndefined()
	})

	it('records no sweep when the placeholder is on the last line, with none below it', () => {
		expect(spun(['▶ run', `16${TICK}`], '⠋', { size: WIDE }).sweep).toBeUndefined()
	})
})

// A clock each sleep moves forward and every write it saw.
function clocked(now_ms: number): {
	ports: Parameters<typeof spin_to_second>[1]
	writes: Array<{ at_ms: number; text: string }>
} {
	const clock = { now_ms }
	const writes: Array<{ at_ms: number; text: string }> = []
	const ports = {
		now: () => clock.now_ms,
		write: (text: string) => {
			writes.push({ at_ms: clock.now_ms, text })
		},
		sleep: async (ms: number) => {
			clock.now_ms += ms
		},
	}

	return { ports, writes }
}

// The sweep's dot cell on screen after each write that moved it.
function dot_cells(writes: ReadonlyArray<{ text: string }>): Array<number> {
	const dots = screens_of(writes).map((screen) =>
		row_text(screen, SWEEP.row)
			.slice(SWEEP.left - 1)
			.indexOf(DOT),
	)

	return dots.filter((dot, index) => dot !== dots[index - 1])
}

// The moments the spinner at the top-left turned on screen, each with the frame it shows.
function turns_of(writes: ReadonlyArray<{ at_ms: number; text: string }>): Array<[number, string]> {
	const shown = screens_of(writes).map((screen) => cell_at(screen, 1, 1).char)

	return writes
		.map(({ at_ms }, index): [number, string] => [at_ms, shown[index] ?? ''])
		.filter(([, char], index) => char !== shown[index - 1])
}

describe('run_board_spin.spin_to_second — the sweep (joshuafolkken/kit#8240)', () => {
	const TURNING = {
		spots: [{ row: 1, column: 1, style: '' }],
		typing: run_board_type_rows.NO_TYPING,
	}

	it('writes each of the twenty cells once in the second, from the left, one per 50 ms', async () => {
		const { ports, writes } = clocked(START)

		await spin_to_second({ ...TURNING, sweep: SWEEP }, ports)

		expect(dot_cells(writes)).toStrictEqual(Array.from({ length: CELLS }, (_, cell) => cell))
		expect(ports.now()).toBe(START + REDRAW_MS)
	})

	it('moves the sweep where the frame has no spinner or typing row to keep it turning', async () => {
		const { ports, writes } = clocked(START)

		await spin_to_second({ spots: [], typing: run_board_type_rows.NO_TYPING, sweep: SWEEP }, ports)

		expect(dot_cells(writes)).toStrictEqual(Array.from({ length: CELLS }, (_, cell) => cell))
	})

	it('turns the spinner on its own interval alone, as without a sweep', async () => {
		const swept = clocked(START)
		const plain = clocked(START)

		await spin_to_second({ ...TURNING, sweep: SWEEP }, swept.ports)
		await spin_to_second(TURNING, plain.ports)

		const turned = turns_of(swept.writes)
		const turned_ms = turned.map(([at_ms]) => at_ms - START)
		const boundaries = turns_of(plain.writes).map(([at_ms]) => at_ms - START)

		// joshuafolkken/kit#8826: a turn a sweep step just drew is held back by at most one refresh.
		expect(turned).toHaveLength(boundaries.length)
		expect(boundaries.every((due_ms) => is_near(turned_ms, due_ms))).toBe(true)
		expect(turned.every(([at_ms, char]) => char === spinner_of(at_ms))).toBe(true)
	})
})
