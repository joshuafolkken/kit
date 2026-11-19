import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_labels } from './run-board-labels'
import { run_board_row_key } from './run-board-row-key'
import { run_board_spin } from './run-board-spin'
import { run_board_spot } from './run-board-spot'
import { run_board_sweep } from './run-board-sweep'
import { run_board_type_rows } from './run-board-type-rows'

const { SWEEP_MS, sweep_bytes, sweep_index, sweep_of } = run_board_sweep
const { SPOT, TICK } = run_board_spot
const { REDRAW_MS, spin_to_second, spun } = run_board_spin
const { SPINNER_INTERVAL_MS } = run_board_labels
const START = Date.parse('2026-11-19T09:00:00.000Z')
const WIDE = { rows: 24, columns: 80 }
const CELLS = 20
const ESCAPE = '\u{1B}'
const DOT = '▪'
const SWEEP = { row: 4, left: 8 }
// eslint-disable-next-line no-control-regex -- a sweep write is a cursor move then its cells
const SWEEP_WRITE = /\u{1B}\[4;8H([ ▪]{20})/u

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
		const drawn = spun(LINES, '⠋', WIDE)

		expect(drawn.lines[2]).toBe(THIRD_DRAWN)
		expect(drawn.sweep).toStrictEqual({ row: 4, left: 1 })
	})

	it('keeps the placeholder apart from a keyed third line’s key', () => {
		const third = `${SPOT}   16${TICK}  ${run_board_row_key.keyed('now', 'WRITE', 'WRITE')}`
		const drawn = spun(['▶ run', 'kit', third, ''], '⠋', WIDE)

		expect(drawn.keyed.map(({ key }) => key)).toStrictEqual(['now:WRITE'])
		expect(drawn.lines[2]).toBe(THIRD_DRAWN)
		expect(drawn.sweep).toStrictEqual({ row: 4, left: 1 })
	})

	it('records no sweep with no placeholder or no fourth row on screen', () => {
		expect(spun(['▶ run', '', ''], '⠋', WIDE).sweep).toBeUndefined()
		expect(spun(LINES, '⠋', { rows: 3, columns: 80 }).sweep).toBeUndefined()
	})

	it('records no sweep when the placeholder is on the last line, with none below it', () => {
		expect(spun(['▶ run', `16${TICK}`], '⠋', WIDE).sweep).toBeUndefined()
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

function dot_cells(writes: ReadonlyArray<{ text: string }>): Array<number> {
	return writes
		.map(({ text }) => SWEEP_WRITE.exec(text)?.[1])
		.filter((cells) => cells !== undefined)
		.map((cells) => cells.indexOf(DOT))
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

		const turned = swept.writes.filter(({ text }) => text.includes(`${ESCAPE}[1;1H`))

		expect(turned.map(({ at_ms }) => at_ms)).toStrictEqual(plain.writes.map(({ at_ms }) => at_ms))
		expect(turned.every(({ at_ms }) => (at_ms - START) % SPINNER_INTERVAL_MS === 0)).toBe(true)
	})
})
