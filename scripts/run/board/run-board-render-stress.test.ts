import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_render_stress_fixture } from './run-board-render-stress-fixture'

// joshuafolkken/kit#4518: the render suites pin each row's text one at a time, so a long value, a
// full-width title or a narrow pane shifted a row or cut the wrong part with every test green
// (#4292, #4288, #4060, #4052, #4099). One board carrying them all pins, per section, the column each
// row's number starts in, and what a narrowing or shortening pane gives up first.

const { CROSS, DONE, HELD, LANES, NOTE_TEXT, REASONED, RUNNING, STOPPED, WIDE_REASON, lines_on } =
	run_board_render_stress_fixture
const LANE_ROWS = [RUNNING, HELD, STOPPED]
const WAITING_ROWS = [CROSS, LANES, REASONED]
const CONDITION_ROWS = [...WAITING_ROWS, DONE]
const NARROW = 70
const LANE_PANE = 90
const PANES = [undefined, NARROW, 50]
const WIDEST = 160
const TIGHTEST = 40
const TALLEST = 60
// The reasoned row's title cut to its floor, the least it gives up before its reason.
const FLOORED = 'Issue 4…'
const LEGEND = '🔨 implement'
const PROCESS_DETAIL = '🧭 supervisor'

function line_of(lines: ReadonlyArray<string>, number: number): string {
	return lines.find((line) => line.includes(`${String(number)} `)) ?? ''
}

// The column a row's number starts in, as the terminal counts it.
function number_column(lines: ReadonlyArray<string>, number: number): number {
	const line = line_of(lines, number)
	const lead = line.slice(0, line.indexOf(String(number)))

	return run_board_fit.width_of(lead)
}

function columns_of(lines: ReadonlyArray<string>, numbers: ReadonlyArray<number>): Set<number> {
	return new Set(numbers.map((number) => number_column(lines, number)))
}

describe('run_board_render.render — a board of long values, by section', () => {
	it.each(PANES)('starts every lane row’s number in one column on a pane of %s', (columns) => {
		const lines = lines_on(columns)

		expect(LANE_ROWS.map((number) => line_of(lines, number))).not.toContain('')
		expect(columns_of(lines, LANE_ROWS)).toHaveProperty('size', 1)
	})

	it.each(PANES)('starts every condition row’s number in one column on a pane of %s', (columns) => {
		const lines = lines_on(columns)

		expect(CONDITION_ROWS.map((number) => line_of(lines, number))).not.toContain('')
		expect(columns_of(lines, CONDITION_ROWS)).toHaveProperty('size', 1)
	})

	// A lane row's head — its times and usage cells — is wider than a waiting row's, so its pane is too.
	it.each([
		[LANE_ROWS, LANE_PANE],
		[WAITING_ROWS, NARROW],
	])('keeps the rows %j within a pane of %i, measured in terminal columns', (numbers, columns) => {
		const lines = lines_on(columns)

		for (const number of numbers) {
			expect(run_board_fit.width_of(line_of(lines, number))).toBeLessThanOrEqual(columns)
		}
	})
})

// The reasoned row at one pane width: whether its title is at its floor, and its reason whole.
function reasoned_at(columns: number): { is_floored: boolean; is_whole: boolean } {
	const line = line_of(lines_on(columns), REASONED)

	return { is_floored: line.includes(FLOORED), is_whole: line.includes(WIDE_REASON) }
}

function widths(): Array<number> {
	return Array.from({ length: WIDEST - TIGHTEST + 1 }, (_, index) => WIDEST - index)
}

describe('run_board_render.render — what a narrowing pane cuts first', () => {
	const cuts = widths().map((columns) => reasoned_at(columns))

	it('cuts a reasoned row’s title to its floor before any of its reason', () => {
		expect(cuts.filter((cut) => !cut.is_whole).every((cut) => cut.is_floored)).toBe(true)
	})

	it('narrows the title while the reason stays whole, then cuts the reason', () => {
		expect(cuts.at(0)).toStrictEqual({ is_floored: false, is_whole: true })
		expect(cuts.some((cut) => cut.is_floored && cut.is_whole)).toBe(true)
		expect(cuts.at(-1)).toStrictEqual({ is_floored: true, is_whole: false })
	})
})

// The board on a narrow pane of each height, from `TALLEST` rows down, drawn once.
function frames(): Array<{ rows: number; text: string }> {
	const heights = Array.from({ length: TALLEST }, (_, index) => TALLEST - index)

	return heights.map((rows) => ({ rows, text: lines_on(NARROW, rows).join('\n') }))
}

describe('run_board_render.render — what a shortening pane drops first', () => {
	const drawn = frames()

	// The tallest pane that no longer draws `marker`.
	function gone_at(marker: string): number {
		return drawn.find((frame) => !frame.text.includes(marker))?.rows ?? 0
	}

	it('drops the legend, the finished, the waiting, the process details, the notes, then the lanes', () => {
		const markers = [
			LEGEND,
			`${String(DONE)} `,
			`${String(REASONED)} `,
			`${String(CROSS)} `,
			PROCESS_DETAIL,
			NOTE_TEXT,
			`${String(STOPPED)} `,
			`${String(RUNNING)} `,
		]
		const gone = markers.map((marker) => gone_at(marker))

		expect(Math.max(...gone)).toBeLessThan(TALLEST)
		expect(gone).toStrictEqual(gone.toSorted((left, right) => right - left))
		expect(new Set(gone)).toHaveProperty('size', markers.length)
	})
})
