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
// Each label and the side of its figures it stands over: a count's right end, a span's left end.
const LABELS: ReadonlyArray<readonly [string, 'start' | 'end']> = [
	['/h', 'end'],
	['ACTIVE', 'start'],
	['DONE', 'end'],
	['PEAK', 'start'],
	['NOW', 'end'],
]
// Where NOW ended before joshuafolkken/kit#8235 tightened the columns, how far left it moved, and how
// far right joshuafolkken/kit#8257's row indent moved every row.
const OLD_NOW_END = 89
const NOW_SHIFT = 8
const INDENT_SHIFT = 3
const MOST_DONE = 9999
const MOST_NOW = 999

function cell(done: number, active_hours = 1): ThroughputCell {
	return { start_ms: 0, end_ms: HOUR, done, active_ms: active_hours * HOUR }
}

function day_row(cells: ReadonlyArray<ThroughputCell>): ThroughputRow {
	return {
		label: '24h',
		cells,
		window_ms: 24 * HOUR,
		active_ms: 19 * HOUR,
		done: 89,
		per_hour: 3.9,
		peak: { done: 7, per_hour: 7, start_ms: new Date(2026, 10, 1, 10).getTime() },
		now: 5,
	}
}

function week_row(cells: ReadonlyArray<ThroughputCell>): ThroughputRow {
	return {
		label: '7d',
		cells,
		window_ms: WEEK_HOURS * HOUR,
		active_ms: 131 * HOUR,
		done: 410,
		per_hour: 3.4,
		peak: { done: 52, per_hour: 4.3, start_ms: new Date(2026, 9, 29, 0).getTime() },
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

// The side of each label its figures are aligned to, as drawn on the rule.
function label_sides(rule: string): Array<number> {
	return LABELS.map(([label, align]) => {
		const start = run_board_fit.width_of(rule.slice(0, rule.indexOf(` ${label} `) + 1))

		return align === 'start' ? start : start + label.length
	})
}

// The same side of each column's figures across the rows: the leftmost start, the rightmost end.
function figure_sides(lines: ReadonlyArray<string>): Array<number> {
	const spans = lines.map((line) => figure_spans(line))

	return LABELS.map(([, align], index) => {
		const column = spans.flatMap((row) => row.slice(index, index + 1))

		return align === 'start'
			? Math.min(...column.map((span) => span.start))
			: Math.max(...column.map((span) => span.end))
	})
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
	it('draws each figure, and the 7d row with no NOW', () => {
		const [rule, day, week] = drawn([day_row(ramp(24)), week_row(ramp(14))])

		expect(rule).toMatch(/^── 📈 throughput ─+ \/h ─+ ACTIVE ─+ DONE ─+ PEAK ─+ NOW ─+$/u)
		expect(day?.endsWith('█   3.9    19/ 24h     89   7.0 @ 11-01 10     5')).toBe(true)
		expect(week?.endsWith('   3.4   131/168h    410   4.3 @ 10-29 00')).toBe(true)
	})

	it('aligns both rows column by column, /h DONE NOW over the figures’ right ends, ACTIVE PEAK over their left', () => {
		const [rule = '', day = '', week = ''] = drawn([day_row(ramp(24)), week_row(ramp(14))])

		expect(figure_ends(week)).toStrictEqual(figure_ends(day).slice(0, -1))
		expect(label_sides(rule)).toStrictEqual(figure_sides([day, week]))
	})

	it('keeps the widest figures aligned under their labels, NOW ending 8 columns further left', () => {
		const day = { ...day_row(ramp(24)), done: MOST_DONE, now: MOST_NOW }
		const week = { ...week_row(ramp(14)), active_ms: WEEK_HOURS * HOUR, done: MOST_DONE }
		const [rule = '', day_line = '', week_line = ''] = drawn([day, week])
		const day_ends = figure_ends(day_line)

		expect(week_line).toContain('  168/168h   9999')
		expect(figure_ends(week_line)).toStrictEqual(day_ends.slice(0, -1))
		expect(label_sides(rule)).toStrictEqual(figure_sides([day_line, week_line]))
		expect(day_ends.at(-1)).toBeLessThanOrEqual(OLD_NOW_END - NOW_SHIFT + INDENT_SHIFT)
	})

	it('marks no label icon, so the theme draws the rule as it stands', () => {
		const [rule = ''] = run_board_render_throughput.rows_part([day_row(ramp(24))]).head.slice(1)

		expect(rule).not.toContain(run_board_label_pair.MARK)
	})

	it('draws a row with no active time and no peak as dashes', () => {
		const idle = { ...week_row([cell(0, 0)]), per_hour: undefined, peak: undefined, done: 0 }
		const [, line] = drawn([idle])

		expect(line).toMatch(/┊ +- {2,}131\/168h {2,}0 {2,}-$/u)
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
		expect(part?.summary).toBe('24h 3.9/h · 7d 3.4/h')
	})
})
