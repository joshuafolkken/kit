import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import { run_board_drop_screen, type DropScreen } from './run-board-drop-screen'
import { run_board_idle_rain } from './run-board-idle-rain'
import { run_board_rain_drop, type Fall } from './run-board-rain-drop'
import { run_board_type_rows } from './run-board-type-rows'

// joshuafolkken/kit#8629: a deja vu rains over the whole matrix board — six drops a step for its first
// second, at the pour's doubled pace, with trails 40% to 100% of the screen, painting over the text and
// hurrying once its last drop is in.

const { DEJA_STEPS, DROP_MS, drop_bytes, falls_at, head_row, poured } = run_board_rain_drop
const { POUR } = run_board_idle_rain
const START_MS = 100 * MS_PER_SECOND
const COLUMNS = 40
const ROWS = 60
const TALL_ROWS = 400
const PER_STEP = 6
const SHARE = 0.25
const COVERED_ROW = 10
// `1 + Math.floor(SHARE * COLUMNS)`: the column every drop falls down under `constant`.
const COLUMN = 11
const CELL = `${String(COVERED_ROW)};${String(COLUMN)}`

function constant(): number {
	return SHARE
}

function screen_of(lines: ReadonlyArray<string>, deja_starts: ReadonlyArray<number>): DropScreen {
	const screen = run_board_drop_screen.screen_of(
		{ lines, spots: [] },
		run_board_type_rows.NO_TYPING,
		{ columns: COLUMNS, rows: lines.length },
	)

	return poured(screen, [], START_MS, deja_starts)
}

function blank(rows: number): DropScreen {
	return screen_of(
		Array.from({ length: rows }, () => ''),
		[START_MS],
	)
}

// A share that differs from drop to drop and is the same for the same values.
function hashed(values: ReadonlyArray<number>): number {
	const seed = values.reduce((sum, value, index) => sum + value * (index + 1), 0)

	return Math.abs(Math.sin(seed))
}

function covering(screen: DropScreen, at_ms: number): Array<Fall> {
	return falls_at(screen, at_ms, hashed).filter((fall) => fall.covers === true)
}

// What `bytes` writes at `CELL`, up to the next cell's address.
function written_at(bytes: string): string | undefined {
	return new RegExp(String.raw`\u001B\[${CELL}H(.*?)(?=\u001B\[\d+;\d+H|$)`, 'u').exec(bytes)?.[1]
}

function counts_by_step(falls: ReadonlyArray<Fall>): Map<number, number> {
	const counts = new Map<number, number>()

	for (const fall of falls) counts.set(fall.born_ms, (counts.get(fall.born_ms) ?? 0) + 1)

	return counts
}

describe('run_board_rain_drop deja vu rain entry', () => {
	it('pours six drops on each of the deja vu’s first twenty steps and none on any other', () => {
		const counts = counts_by_step(covering(blank(TALL_ROWS), START_MS + 2 * MS_PER_SECOND))
		const steps = Array.from({ length: DEJA_STEPS }, (_, step) => START_MS + step * DROP_MS)

		expect([...counts.keys()].toSorted((left, right) => left - right)).toEqual(steps)
		expect(new Set(counts.values())).toEqual(new Set([PER_STEP]))
	})

	it('pours none before the deja vu and none on a board with no deja vu', () => {
		expect(covering(blank(TALL_ROWS), START_MS - DROP_MS)).toEqual([])
		expect(covering(screen_of([''], []), START_MS)).toEqual([])
	})
})

describe('run_board_rain_drop deja vu drop', () => {
	it('draws each trail 40% to 100% of the screen, the same on every read', () => {
		const at_ms = START_MS + (DEJA_STEPS - 1) * DROP_MS
		const falls = covering(blank(ROWS), at_ms)

		expect(falls).toHaveLength(DEJA_STEPS * PER_STEP)

		for (const fall of falls) {
			expect(fall.length).toBeGreaterThanOrEqual(Math.round(ROWS * 0.4))
			expect(fall.length).toBeLessThanOrEqual(ROWS)
		}

		expect(covering(blank(ROWS), at_ms)).toEqual(falls)
	})

	it('takes its trail and pace from its share: round(H × (0.4 + r × 0.6)), (0.6 + r × 0.5) × 2', () => {
		const fall = falls_at(blank(ROWS), START_MS, constant).find((each) => each.covers === true)

		expect(fall?.length).toBe(Math.round(ROWS * (0.4 + SHARE * 0.6)))
		expect(fall?.speed).toBeCloseTo((POUR.least + SHARE * POUR.spread) * 2)
	})

	it('falls at its own pace for a second, then once more its pace for each second past it', () => {
		const screen = blank(ROWS)
		const fall = falls_at(screen, START_MS, constant).find((each) => each.covers === true)
		const speed = (POUR.least + SHARE * POUR.spread) * 2
		const steps = 2 * DEJA_STEPS
		const rows = Array.from(
			{ length: steps },
			(_, step) => speed * (1 + Math.max(0, step * DROP_MS - MS_PER_SECOND) / MS_PER_SECOND),
		).reduce((sum, value) => sum + value, 0)

		expect(fall).toBeDefined()
		if (fall === undefined) return
		expect(head_row(fall, START_MS + (DEJA_STEPS / 2) * DROP_MS)).toBe(1 + Math.floor(speed * 10))
		expect(head_row(fall, START_MS + steps * DROP_MS)).toBe(1 + Math.floor(rows))
	})
})

describe('run_board_rain_drop deja vu over the board', () => {
	const text = Array.from({ length: ROWS }, () => 'X'.repeat(COLUMNS))
	const covered_ms = START_MS + (DEJA_STEPS / 2) * DROP_MS

	it('paints its code over a cell with text, past the two cells a drop lights', () => {
		const written = written_at(
			drop_bytes(screen_of(text, [START_MS]), covered_ms, undefined, constant),
		)

		expect(written).toBeDefined()
		expect(written).not.toContain('X')
	})

	it('puts the cell back as the board drew it once the last trail has passed', () => {
		const screen = screen_of(text, [START_MS])
		const passed_ms = START_MS + 4 * MS_PER_SECOND
		const restored = run_board_drop_screen.cell_at(screen, { row: COVERED_ROW, column: COLUMN })

		expect(written_at(drop_bytes(screen, passed_ms, covered_ms, constant))).toContain(restored.text)
		expect(restored.text).toBe('X')
	})

	it('draws nothing on a cell something else writes, as the idle rain panel’s', () => {
		const screen = { ...screen_of(text, [START_MS]), skips: new Set([CELL]) }

		expect(written_at(drop_bytes(screen, covered_ms, undefined, constant))).toBeUndefined()
	})
})

describe('run_board_rain_drop.poured deja vu spans', () => {
	it('keeps one span a deja vu, its rain’s second long, while its drops can be on screen', () => {
		const lines = Array.from({ length: ROWS }, () => '')

		expect(screen_of(lines, [START_MS, START_MS]).deja_spans).toEqual([
			{ from_ms: START_MS, to_ms: START_MS + MS_PER_SECOND },
		])
		expect(screen_of(lines, [START_MS - 100 * MS_PER_SECOND]).deja_spans).toEqual([])
	})
})
