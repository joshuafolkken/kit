import { figure_format } from '#scripts/lib/figure-format'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_board_fit, type DetailPart } from './run-board-fit'
import { run_board_lamps } from './run-board-lamps'
import { run_board_render_section } from './run-board-render-section'
import type { Peak, ThroughputCell, ThroughputRow } from './run-board-throughput'

// The `📈 throughput` section of `run:board` (joshuafolkken/kit#5705): per row its cells as a
// sparkline, each normalized to its own window's busiest cell and `┊` where the run was stopped
// throughout, then the closes per active hour, the active hours, the closes, the peak and — the `24h`
// row's alone — the closes in the cell still filling. The values are `run-board-throughput.ts`'s.

const LABEL = '📈 throughput'
const LEVELS = '▁▂▃▄▅▆▇█'
const STOPPED_MARK = '┊'
const { ROW_INDENT } = run_board_render_section
const ROW_LABEL_WIDTH = 3
const COLUMN_GAP_WIDTH = 2
const COLUMN_GAP = ' '.repeat(COLUMN_GAP_WIDTH)
// `columns_rule` puts a blank, a rule and a blank between two labels: a column one wider than its
// label leaves the rule room.
const LABEL_CLEARANCE = 1
// The `24h` row's 24 cells; the `7d` row's 14 are drawn from the left in the same width.
const SPARK_WIDTH = 24
// Where the first column starts: the indent, the row's label, its gap and the sparkline.
const LEAD_WIDTH = ROW_INDENT.length + ROW_LABEL_WIDTH + COLUMN_GAP_WIDTH + SPARK_WIDTH
const HOUR_WIDTH = 3
const DONE_WIDTH = 4
const RATE_WIDTH = 4
const MINUTES_PER_HOUR = 60
const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE
const NONE = '-'
const { two_digits } = figure_format

// A label stands over its column's figures (joshuafolkken/kit#8257): `end` at their right end, as a
// count's is read, `start` at their left end, as a span's or a time's is.
interface Column {
	label: string
	align: 'start' | 'end'
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

// The labels carry no icon (joshuafolkken/kit#8235), so a column is as wide as its word needs.
const COLUMNS: ReadonlyArray<Column> = [
	{ label: '/h', align: 'end', text: (row) => rate_of(row.per_hour) },
	{
		label: 'ACTIVE',
		align: 'start',
		text: (row) => `${hours_of(row.active_ms)}/${hours_of(row.window_ms)}h`,
	},
	{ label: 'DONE', align: 'end', text: (row) => String(row.done).padStart(DONE_WIDTH) },
	{ label: 'PEAK', align: 'start', text: (row) => peak_text(row.peak) },
	{
		label: 'NOW',
		align: 'end',
		text: (row) => (row.now === undefined ? '' : String(row.now)),
	},
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

// A cell's columns, with a blank before a figure that starts its text in a column whose label stands at
// the figures' left end — so a label there keeps the rule's room from an `end` label before it however
// many digits the figure has (`131/168h`).
function cell_width(column: Column, text: string): number {
	const lead = column.align === 'start' && !text.startsWith(' ') ? LABEL_CLEARANCE : 0

	return run_board_fit.width_of(text) + lead
}

function width_of(column: Column, rows: ReadonlyArray<ThroughputRow>): number {
	const label = run_board_fit.width_of(column.label) + LABEL_CLEARANCE
	const cells = rows.map((row) => cell_width(column, column.text(row)))

	return Math.max(label, ...cells)
}

// Each column's width, the widest of its cells and its label's room, so the two rows' columns stand
// aligned.
function widths_of(rows: ReadonlyArray<ThroughputRow>): Array<number> {
	return COLUMNS.map((column) => width_of(column, rows))
}

function lead_of(row: ThroughputRow): string {
	return `${ROW_INDENT}${row.label.padStart(ROW_LABEL_WIDTH)}${COLUMN_GAP}${sparkline(row.cells)}`
}

// A row with a lamp panel starts it two columns past its NOW column, the same column on both rows
// (joshuafolkken/kit#8236).
function line_of(row: ThroughputRow, widths: ReadonlyArray<number>, panel?: string): string {
	const cells = COLUMNS.map((column, index) => column.text(row).padStart(widths[index] ?? 0))
	const line = [lead_of(row), ...cells].join(COLUMN_GAP)

	return panel === undefined ? line.trimEnd() : `${line}${COLUMN_GAP}${panel}`
}

// The blanks before a column's figures in a `width`-wide column, its fewest across the rows; a label
// at the column's right end where no row draws a figure.
function figures_offset(column: Column, rows: ReadonlyArray<ThroughputRow>, width: number): number {
	const label = run_board_fit.width_of(column.label)
	const blanks = rows
		.map((row) => column.text(row).padStart(width))
		.filter((text) => text.trim() !== '')
		.map((text) => text.length - text.trimStart().length)

	return column.align === 'end' ? width - label : Math.min(width - label, ...blanks)
}

// Each label stands over its column's figures, at their right or left end by its `align`.
function rule_columns(
	widths: ReadonlyArray<number>,
	rows: ReadonlyArray<ThroughputRow>,
): Array<{ label: string; start: number }> {
	let start = LEAD_WIDTH + COLUMN_GAP_WIDTH

	return COLUMNS.map((column, index) => {
		const width = widths[index] ?? 0
		const placed = { label: column.label, start: start + figures_offset(column, rows, width) }

		start += width + COLUMN_GAP_WIDTH

		return placed
	})
}

// A folded section says each row's closes per active hour: `24h 4.0/h · 7d 2.9/h`.
function summary_of(rows: ReadonlyArray<ThroughputRow>): string {
	return rows.map((row) => `${row.label} ${rate_of(row.per_hour).trim()}/h`).join(' · ')
}

// Where the frame `has_lamps`, each row ends on where its lamp panel starts (`run-board-lamps.ts`).
function rows_part(rows: ReadonlyArray<ThroughputRow>, has_lamps = false): DetailPart {
	const widths = widths_of(rows)
	const lines = rows.map((row, index) => ({
		text: line_of(row, widths, has_lamps ? run_board_lamps.start_of(index) : undefined),
		is_detail: false,
	}))
	const rule = run_board_render_section.columns_rule(LABEL, rule_columns(widths, rows))

	return { head: ['', rule], lines, label: LABEL, summary: summary_of(rows) }
}

// None where no rows were read — a frame drawn with no throughput.
function throughput_part(
	rows: ReadonlyArray<ThroughputRow> | undefined,
	has_lamps = false,
): DetailPart | undefined {
	return rows === undefined ? undefined : rows_part(rows, has_lamps)
}

const run_board_render_throughput = { rows_part, throughput_part }

export { run_board_render_throughput }
