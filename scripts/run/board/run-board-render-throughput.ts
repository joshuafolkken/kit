import { figure_format } from '#scripts/lib/figure-format'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_board_fit, type DetailPart } from './run-board-fit'
import { run_board_render_section } from './run-board-render-section'
import type { Peak, ThroughputCell, ThroughputRow } from './run-board-throughput'

// The `📈 throughput` section of `run:board` (joshuafolkken/kit#5705): per row its cells as a
// sparkline, each normalized to its own window's busiest cell and `┊` where the run was stopped
// throughout, then the closes per active hour, the active hours, the closes, the peak and — the `24h`
// row's alone — the closes in the cell still filling. The values are `run-board-throughput.ts`'s.

const LABEL = '📈 throughput'
const LEVELS = '▁▂▃▄▅▆▇█'
const STOPPED_MARK = '┊'
const INDENT = '  '
const ROW_LABEL_WIDTH = 3
const COLUMN_GAP_WIDTH = 3
const COLUMN_GAP = ' '.repeat(COLUMN_GAP_WIDTH)
// The `24h` row's 24 cells; the `7d` row's 14 are drawn from the left in the same width.
const SPARK_WIDTH = 24
// Where the first column starts: the indent, the row's label, its gap and the sparkline.
const LEAD_WIDTH = `${INDENT}${INDENT}`.length + ROW_LABEL_WIDTH + SPARK_WIDTH
const HOUR_WIDTH = 3
const DONE_WIDTH = 4
const RATE_WIDTH = 4
const MINUTES_PER_HOUR = 60
const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE
const NONE = '-'
const { two_digits } = figure_format

interface Column {
	label: string
	text: (row: ThroughputRow) => string
}

function hours_of(ms: number): string {
	return String(Math.round(ms / MS_PER_HOUR)).padStart(HOUR_WIDTH)
}

function rate_of(value: number | undefined): string {
	return (value === undefined ? NONE : value.toFixed(1)).padStart(RATE_WIDTH)
}

// The local `MM-DD HH` a peak's cell starts at.
function day_hour_of(ms: number): string {
	const date = new Date(ms)
	const day = `${two_digits(date.getMonth() + 1)}-${two_digits(date.getDate())}`

	return `${day} ${two_digits(date.getHours())}`
}

function peak_text(peak: Peak | undefined): string {
	if (peak === undefined) return NONE

	return `${rate_of(peak.per_hour)} @ ${day_hour_of(peak.start_ms)}`
}

const COLUMNS: ReadonlyArray<Column> = [
	{ label: '⚡ /h', text: (row) => rate_of(row.per_hour) },
	{
		label: '🟢 ACTIVE',
		text: (row) => `${hours_of(row.active_ms)}/${hours_of(row.window_ms)}h`,
	},
	{ label: '✅ DONE', text: (row) => String(row.done).padStart(DONE_WIDTH) },
	{ label: '🏔 PEAK', text: (row) => peak_text(row.peak) },
	{ label: '🔄 NOW', text: (row) => (row.now === undefined ? '' : String(row.now)) },
]

function level_of(cell: ThroughputCell, most: number): string {
	if (cell.active_ms === 0) return STOPPED_MARK

	const index = most === 0 ? 0 : Math.ceil((cell.done * (LEVELS.length - 1)) / most)

	return LEVELS.charAt(index)
}

function sparkline(cells: ReadonlyArray<ThroughputCell>): string {
	const most = Math.max(0, ...cells.map((cell) => cell.done))

	return cells
		.map((cell) => level_of(cell, most))
		.join('')
		.padEnd(SPARK_WIDTH)
}

function width_of(column: Column, rows: ReadonlyArray<ThroughputRow>): number {
	const texts = [column.label, ...rows.map((row) => column.text(row))]

	return Math.max(...texts.map((text) => run_board_fit.width_of(text)))
}

// Each column's width, the widest of its label and its cells, so the two rows' columns stand aligned.
function widths_of(rows: ReadonlyArray<ThroughputRow>): Array<number> {
	return COLUMNS.map((column) => width_of(column, rows))
}

function lead_of(row: ThroughputRow): string {
	return `${INDENT}${row.label.padStart(ROW_LABEL_WIDTH)}${INDENT}${sparkline(row.cells)}`
}

function line_of(row: ThroughputRow, widths: ReadonlyArray<number>): string {
	const cells = COLUMNS.map((column, index) => column.text(row).padStart(widths[index] ?? 0))

	return [lead_of(row), ...cells].join(COLUMN_GAP).trimEnd()
}

// Each label stands where its column starts.
function rule_columns(widths: ReadonlyArray<number>): Array<{ label: string; start: number }> {
	let start = LEAD_WIDTH + COLUMN_GAP_WIDTH

	return COLUMNS.map((column, index) => {
		const placed = { label: column.label, start }

		start += (widths[index] ?? 0) + COLUMN_GAP_WIDTH

		return placed
	})
}

// A folded section says each row's closes per active hour: `24h 4.0/h · 7d 2.9/h`.
function summary_of(rows: ReadonlyArray<ThroughputRow>): string {
	return rows.map((row) => `${row.label} ${rate_of(row.per_hour).trim()}/h`).join(' · ')
}

function rows_part(rows: ReadonlyArray<ThroughputRow>): DetailPart {
	const widths = widths_of(rows)
	const lines = rows.map((row) => ({ text: line_of(row, widths), is_detail: false }))
	const rule = run_board_render_section.columns_rule(LABEL, rule_columns(widths))

	return { head: ['', rule], lines, label: LABEL, summary: summary_of(rows) }
}

// None where no rows were read — a frame drawn with no throughput.
function throughput_part(rows: ReadonlyArray<ThroughputRow> | undefined): DetailPart | undefined {
	return rows === undefined ? undefined : rows_part(rows)
}

const run_board_render_throughput = { rows_part, throughput_part }

export { run_board_render_throughput }
