import { run_board_fit, type PlanLine, type PlanSection } from './run-board-fit'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_render_section, type RuleColumn } from './run-board-render-section'
import type { LaneUsages, UsageFigure, UsageScale } from './run-board-usage'
import { run_board_usage_text } from './run-board-usage-text'

// The run's own rows' CPU, MEM and CMPRS cells, right after each row's number, under a rule whose
// labels stand over them: `── 🧵 lanes ── 💪 CPU ─ 🧠 MEM ─ 🤏 CMPRS ───`. A running row draws its
// lane's figures; every other row blanks of the same width, so every kind icon and title after them
// starts in one column. Drawn with gauges on a terminal and as figures alone anywhere else.

const { HEADER_ICONS } = run_board_labels
const { cell_widths, cells_of } = run_board_usage_text
const { columns_rule, label_room } = run_board_render_section
const { width_of } = run_board_fit
const GAUGE = 5
const CELL_GAP = ' '
// What a column needs past its label so the next label still has a rule before it: ` ─`.
const LABEL_TAIL = 2
// Icons Unicode draws as emoji by default, which `string-width` counts two columns wide as a
// terminal draws them: 🛤 and 🗜, text symbols drawn as emoji, overlapped the blank after them.
const LANES_LABEL = '🧵 lanes'
const COLUMN_LABELS = [`${HEADER_ICONS.cpu} CPU`, `${HEADER_ICONS.memory} MEM`, '🤏 CMPRS']
// What a row draws before its number: the indent and the state icon, then a blank.
const NUMBER_START = '  🔄 '

// What one frame's lane cells are drawn with.
interface LaneCells {
	usages: LaneUsages
	scale: UsageScale
	gauge: number
	// The widest row number of the section, so the cells after it start in one column.
	number_width: number
}

// The gauge drawn after each figure — none where the frame is not drawn on a terminal, which draws no
// spinner.
function gauge_of(header: BoardHeader): number {
	return header.spinner === undefined ? 0 : GAUGE
}

// Each column's width: its cell's, widened where its label is wider.
function column_widths(gauge: number): Array<number> {
	return cell_widths(gauge).map((width, index) =>
		Math.max(width, width_of(COLUMN_LABELS[index] ?? '') + LABEL_TAIL),
	)
}

// A figure's cells, each right-aligned in its column.
function column_cells(figure: UsageFigure | undefined, scale: UsageScale, gauge: number): string {
	const widths = column_widths(gauge)
	const cells = cells_of(figure, scale, gauge).map(
		(cell, index) => `${' '.repeat(Math.max(0, (widths[index] ?? 0) - width_of(cell)))}${cell}`,
	)

	return cells.join(CELL_GAP)
}

// The width a section's lead — what is drawn before its first column — is padded to: its widest, or
// wider where the rule's own label would otherwise push the first column's label past its cells.
function lead_width(widest: number, label: string, lead_start: number): number {
	return Math.max(widest, label_room(label) - lead_start - CELL_GAP.length)
}

// `undefined` where the frame read no usage, which draws no cells.
function lane_cells_of(header: BoardHeader, rows: ReadonlyArray<BoardRow>): LaneCells | undefined {
	const { usages } = header

	if (usages === undefined) return undefined

	const widest = Math.max(0, ...rows.map((row) => String(row.number).length))

	return {
		usages: usages.lanes,
		scale: usages.scale,
		gauge: gauge_of(header),
		number_width: lead_width(widest, LANES_LABEL, width_of(NUMBER_START)),
	}
}

// A row's number as linked, then — where cells are drawn — padded to the section's widest and
// followed by its cells.
function number_text(
	row: BoardRow,
	cells: LaneCells | undefined,
	link: (text: string) => string,
): string {
	const number = String(row.number)

	if (cells === undefined) return link(number)

	const figure = row.state === 'running' ? cells.usages.get(row.number) : undefined
	const drawn = column_cells(figure, cells.scale, cells.gauge)

	return `${link(number)}${' '.repeat(cells.number_width - number.length)} ${drawn}`
}

// Each column's label, placed at the column its cells start at, the first at `first`.
function label_columns(first: number, gauge: number): Array<RuleColumn> {
	let start = first

	return column_widths(gauge).map((width, index) => {
		const column = { label: COLUMN_LABELS[index] ?? '', start }

		start += width + CELL_GAP.length

		return column
	})
}

// The run's own rows under the lanes rule where cells are drawn, under a blank line where not.
function lanes_section(
	lines: ReadonlyArray<PlanLine>,
	cells: LaneCells | undefined,
): Array<PlanSection> {
	if (lines.length === 0) return []

	if (cells === undefined) return [{ head: [''], lines }]

	const first = width_of(NUMBER_START) + cells.number_width + CELL_GAP.length
	const rule = columns_rule(LANES_LABEL, label_columns(first, cells.gauge))

	return [{ head: ['', rule], lines }]
}

const run_board_render_lanes = {
	COLUMN_LABELS,
	LANES_LABEL,
	column_cells,
	label_columns,
	lane_cells_of,
	lanes_section,
	lead_width,
	number_text,
}

export { run_board_render_lanes }
export type { LaneCells }
