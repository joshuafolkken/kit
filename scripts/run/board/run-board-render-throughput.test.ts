import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_label_pair } from './run-board-label-pair'
import { run_board_render_throughput } from './run-board-render-throughput'
import type { ThroughputCell, ThroughputRow } from './run-board-throughput'

// joshuafolkken/kit#5710: the `📈 throughput` section drawn from the cells `run-board-throughput.ts`
// derives — a 24-column sparkline per row, then its figures in columns both rows share.

const HOUR = 3_600_000
const WEEK_HOURS = 168
// The row's label starts at the shared row indent (joshuafolkken/kit#8257); the sparkline follows it
// and its gap: `     24h  `.
const ROW_LABEL_START = run_board_fit.ROW_INDENT.length
const ROW_LABEL_WIDTH = 3
const SPARK_START = ROW_LABEL_START + ROW_LABEL_WIDTH + 2
const SPARK_WIDTH = 24
// Each label stands over its figures' right end (joshuafolkken/kit#8280).
const LABELS: ReadonlyArray<string> = ['/h', 'ACTIVE', 'DONE', 'PEAK', 'NOW']
// The column the `24h` row ends at with the approved sample's figures, and with the widest figures the
// columns' fewest characters hold (joshuafolkken/kit#8280).
const ROW_END = 67
const MOST_DONE = 9999
const MOST_NOW = 999
const WIDER_DONE = 999_999

function cell(done: number, active_hours = 1): ThroughputCell {
	return { start_ms: 0, end_ms: HOUR, done, active_ms: active_hours * HOUR }
}

// The approved sample's figures (joshuafolkken/kit#8280).
function day_row(cells: ReadonlyArray<ThroughputCell>): ThroughputRow {
	return {
		label: '24h',
		cells,
		active_ms: 17 * HOUR,
		done: 76,
		per_hour: 4.4,
		peak: { done: 7, per_hour: 7 },
		now: 3,
	}
}

function week_row(cells: ReadonlyArray<ThroughputCell>): ThroughputRow {
	return {
		label: '7d',
		cells,
		active_ms: 96 * HOUR,
		done: 365,
		per_hour: 3.9,
		peak: { done: 62, per_hour: 5.2 },
		now: undefined,
	}
}

function ramp(count: number): Array<ThroughputCell> {
	return Array.from({ length: count }, (_, index) => cell(index % 8))
}

// The rule, then the rows — the blank above the rule left out, as a frame with no theme draws them.
function drawn(rows: ReadonlyArray<ThroughputRow>): Array<string> {
	const part = run_board_render_throughput.rows_part(rows)
	const lines = [...part.head.slice(1), ...part.lines.map((line) => line.text)]

	return lines.map((line) => run_board_label_pair.bare(line))
}

// The sparkline's characters each take one column and one code unit.
function spark_of(line: string): string {
	return line.slice(SPARK_START, SPARK_START + SPARK_WIDTH)
}

interface Span {
	start: number
	end: number
}

// The columns each figure of a line takes, as `start` and one past its `end` — figures stand two or
// more blanks apart, a figure's own words one — the row's label and the sparkline left out.
function figure_spans(line: string): Array<Span> {
	const spans = [...line.matchAll(/\S+(?: \S+)*/gu)].map((match) => {
		const start = run_board_fit.width_of(line.slice(0, match.index))

		return { start, end: start + run_board_fit.width_of(match[0]) }
	})

	return spans.slice(2)
}

function figure_ends(line: string): Array<number> {
	return figure_spans(line).map((span) => span.end)
}

// The right end of each label, as drawn on the rule.
function label_sides(rule: string): Array<number> {
	return LABELS.map(
		(label) => run_board_fit.width_of(rule.slice(0, rule.indexOf(` ${label} `) + 1)) + label.length,
	)
}

// The right end of each column's figures across the rows.
function figure_sides(lines: ReadonlyArray<string>): Array<number> {
	const spans = lines.map((line) => figure_spans(line))

	return LABELS.map((_, index) =>
		Math.max(...spans.flatMap((row) => row.slice(index, index + 1)).map((span) => span.end)),
	)
}

describe('run_board_render_throughput sparkline', () => {
	it('starts each row’s label field at the row indent', () => {
		const [, day = '', week = ''] = drawn([day_row(ramp(24)), week_row(ramp(14))])

		expect(day.slice(0, SPARK_START)).toBe(`${' '.repeat(ROW_LABEL_START)}24h  `)
		expect(week.slice(0, SPARK_START)).toBe(`${' '.repeat(ROW_LABEL_START)} 7d  `)
	})

	it('normalizes each row to its own busiest cell', () => {
		const [, day = '', week = ''] = drawn([
			day_row(ramp(24)),
			week_row([cell(0), cell(2), cell(4)]),
		])

		expect(spark_of(day)).toBe('▁▂▃▄▅▆▇█▁▂▃▄▅▆▇█▁▂▃▄▅▆▇█')
		expect(spark_of(week).trimEnd()).toBe('▁▅█')
	})

	it('draws a cell stopped throughout as ┊, a partly stopped one by its closes', () => {
		const [, day = ''] = drawn([day_row([cell(2), cell(0, 0), cell(1, 0.5)])])

		expect(spark_of(day).trimEnd()).toBe('█┊▅')
	})

	it('keeps both rows 24 columns: the 7d row 14 cells from the left, then 10 blanks', () => {
		const [, day = '', week = ''] = drawn([day_row(ramp(24)), week_row(ramp(14))])

		expect(spark_of(week)).toBe(`▁▂▃▄▅▆▇█▁▂▃▄▅▆${' '.repeat(10)}`)
		expect(run_board_fit.width_of(spark_of(day))).toBe(SPARK_WIDTH)
	})
})

describe('run_board_render_throughput columns', () => {
	it('draws the active hours and the peak rate alone, the 7d row with no NOW', () => {
		const [rule, day = '', week] = drawn([day_row(ramp(24)), week_row(ramp(14))])

		expect(rule).toMatch(/^── 📈 throughput ─+ \/h ACTIVE ─ DONE ─ PEAK ─ NOW ─+$/u)
		expect(day.endsWith('█   4.4    17h     76    7.0     3')).toBe(true)
		expect(week?.endsWith('   3.9    96h    365    5.2')).toBe(true)
		expect(run_board_fit.width_of(day)).toBe(ROW_END)
	})

	it('aligns both rows column by column, every label over its figures’ right end', () => {
		const [rule = '', day = '', week = ''] = drawn([day_row(ramp(24)), week_row(ramp(14))])

		expect(figure_ends(week)).toStrictEqual(figure_ends(day).slice(0, -1))
		expect(label_sides(rule)).toStrictEqual(figure_sides([day, week]))
	})
})

describe('run_board_render_throughput column widths', () => {
	it('keeps the widest figures the columns hold in place, under their labels', () => {
		const day = { ...day_row(ramp(24)), done: MOST_DONE, now: MOST_NOW }
		const week = { ...week_row(ramp(14)), active_ms: WEEK_HOURS * HOUR, done: MOST_DONE }
		const [rule = '', day_line = '', week_line = ''] = drawn([day, week])
		const day_ends = figure_ends(day_line)

		expect(week_line).toContain('  168h   9999')
		expect(figure_ends(week_line)).toStrictEqual(day_ends.slice(0, -1))
		expect(label_sides(rule)).toStrictEqual(figure_sides([day_line, week_line]))
		expect(day_ends.at(-1)).toBe(ROW_END)
	})

	it('widens a column for a wider figure, the labels still over the figures’ right ends', () => {
		const day = { ...day_row(ramp(24)), done: WIDER_DONE }
		const [rule = '', day_line = '', week_line = ''] = drawn([day, week_row(ramp(14))])

		expect(figure_ends(week_line)).toStrictEqual(figure_ends(day_line).slice(0, -1))
		expect(label_sides(rule)).toStrictEqual(figure_sides([day_line, week_line]))
		expect(run_board_fit.width_of(day_line)).toBe(ROW_END + 1)
	})
})

describe('run_board_render_throughput rule and idle rows', () => {
	it('marks no label icon, so the theme draws the rule as it stands', () => {
		const [rule = ''] = run_board_render_throughput.rows_part([day_row(ramp(24))]).head.slice(1)

		expect(rule).not.toContain(run_board_label_pair.MARK)
	})

	it('draws a row with no active time and no peak as dashes', () => {
		const idle = { ...week_row([cell(0, 0)]), per_hour: undefined, peak: undefined, done: 0 }
		const [, line] = drawn([idle])

		expect(line).toMatch(/┊ +- {2,}96h {2,}0 {2,}-$/u)
	})
})

describe('run_board_render_throughput.throughput_part', () => {
	it('draws no section where no rows were read', () => {
		expect(run_board_render_throughput.throughput_part(undefined)).toBeUndefined()
	})

	it('draws the rows it is handed, folded to each row’s closes per hour', () => {
		const rows = [day_row(ramp(24)), week_row(ramp(14))]
		const part = run_board_render_throughput.throughput_part(rows)
		const labels = part?.lines.map((line) => line.text.trim().split(' ', 1)[0])

		expect(labels).toStrictEqual(['24h', '7d'])
		expect(part?.summary).toBe('24h 4.4/h · 7d 3.9/h')
	})

	// joshuafolkken/kit#8513: the themed screen's alert level rides the rule's right end.
	it('carries the tail it is handed to its rule, and none where it is handed none', () => {
		const rows = [day_row(ramp(24))]

		expect(run_board_render_throughput.throughput_part(rows, false, 'TRACE')?.tail).toBe('TRACE')
		expect(run_board_render_throughput.throughput_part(rows)?.tail).toBeUndefined()
	})
})
