import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_board_fit, type DetailPart } from './run-board-fit'
import { run_board_lamps } from './run-board-lamps'
import { run_board_render_section } from './run-board-render-section'
import type { ThroughputCell, ThroughputRow } from './run-board-throughput'

// The `📈 throughput` section of `run:board` (joshuafolkken/kit#5705): per row its cells as a
// sparkline, each normalized to its own window's busiest cell and `┊` where the run was stopped
// throughout, then the closes per active hour, the active hours, the closes, the peak cell's rate and
// — the `24h` row's alone — the closes in the cell still filling. The values are
// `run-board-throughput.ts`'s.

const LABEL = '📈 throughput'
const LEVELS = '▁▂▃▄▅▆▇█'
const STOPPED_MARK = '┊'
const { ROW_INDENT } = run_board_render_section
const ROW_LABEL_WIDTH = 3
const COLUMN_GAP_WIDTH = 2
const COLUMN_GAP = ' '.repeat(COLUMN_GAP_WIDTH)
// The `24h` row's 24 cells; the `7d` row's 14 are drawn from the left in the same width.
const SPARK_WIDTH = 24
// Where the first column starts: the indent, the row's label, its gap and the sparkline.
const LEAD_WIDTH = ROW_INDENT.length + ROW_LABEL_WIDTH + COLUMN_GAP_WIDTH + SPARK_WIDTH
// Each column's fewest characters, wide enough for `99.9`, `168h` and four-digit closes so the rows'
// figures keep their place (joshuafolkken/kit#8280); a wider figure widens its column.
const RATE_WIDTH = 4
const HOURS_WIDTH = 5
const DONE_WIDTH = 5
const PEAK_WIDTH = 5
const NOW_WIDTH = 4
const MINUTES_PER_HOUR = 60
const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE
const NONE = '-'

// A label stands over its column's figures, at their right end (joshuafolkken/kit#8257,
// joshuafolkken/kit#8280).
interface Column {
	label: string
	width: number
	text: (row: ThroughputRow) => string
}

function rate_of(value: number | undefined): string {
	return value === undefined ? NONE : value.toFixed(1)
}

// The labels carry no icon (joshuafolkken/kit#8235). The row's label already names the window, so
// ACTIVE draws the active hours alone (`17h`), and PEAK the peak cell's rate alone.
const COLUMNS: ReadonlyArray<Column> = [
	{ label: '/h', width: RATE_WIDTH, text: (row) => rate_of(row.per_hour) },
	{
		label: 'ACTIVE',
		width: HOURS_WIDTH,
		text: (row) => `${String(Math.round(row.active_ms / MS_PER_HOUR))}h`,
	},
	{ label: 'DONE', width: DONE_WIDTH, text: (row) => String(row.done) },
	{ label: 'PEAK', width: PEAK_WIDTH, text: (row) => rate_of(row.peak?.per_hour) },
	{
		label: 'NOW',
		width: NOW_WIDTH,
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

function width_of(column: Column, rows: ReadonlyArray<ThroughputRow>): number {
	return Math.max(column.width, ...rows.map((row) => run_board_fit.width_of(column.text(row))))
}

// Each column's width, the widest of its cells and its fewest, so the two rows' columns stand aligned.
function widths_of(rows: ReadonlyArray<ThroughputRow>): Array<number> {
	return COLUMNS.map((column) => width_of(column, rows))
}

function lead_of(row: ThroughputRow): string {
	return `${ROW_INDENT}${row.label.padStart(ROW_LABEL_WIDTH)}${COLUMN_GAP}${sparkline(row.cells)}`
}

// A row with a lamp panel starts it two columns past its NOW column, the same column on both rows
// (joshuafolkken/kit#8236) and the column the panel's other rows start at (joshuafolkken/kit#8277).
function line_of(row: ThroughputRow, widths: ReadonlyArray<number>, panel?: string): string {
	const cells = COLUMNS.map((column, index) => column.text(row).padStart(widths[index] ?? 0))
	const line = [lead_of(row), ...cells].join(COLUMN_GAP)

	return panel === undefined ? line.trimEnd() : `${line}${COLUMN_GAP}${panel}`
}

// Each label ends where its column's figures end; a label wider than its column reaches into the gap
// before it (`ACTIVE`).
function rule_columns(widths: ReadonlyArray<number>): Array<{ label: string; start: number }> {
	let start = LEAD_WIDTH + COLUMN_GAP_WIDTH

	return COLUMNS.map((column, index) => {
		const width = widths[index] ?? 0
		const placed = {
			label: column.label,
			start: start + width - run_board_fit.width_of(column.label),
		}

		start += width + COLUMN_GAP_WIDTH

		return placed
	})
}

// A folded section says each row's closes per active hour: `24h 4.0/h · 7d 2.9/h`.
function summary_of(rows: ReadonlyArray<ThroughputRow>): string {
	return rows.map((row) => `${row.label} ${rate_of(row.per_hour)}/h`).join(' · ')
}

// Where the frame `has_lamps`, each row ends on where its lamp panel starts (`run-board-lamps.ts`).
function rows_part(rows: ReadonlyArray<ThroughputRow>, has_lamps = false): DetailPart {
	const widths = widths_of(rows)
	const lines = rows.map((row, index) => ({
		text: line_of(row, widths, has_lamps ? run_board_lamps.start_of(index) : undefined),
		is_detail: false,
	}))
	const rule = run_board_render_section.columns_rule(LABEL, rule_columns(widths))

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
