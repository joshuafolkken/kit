import { run_board_earlier } from './run-board-earlier'
import { run_board_fit, type PlanLine, type PlanSection, type RowYield } from './run-board-fit'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_render_lead } from './run-board-render-lead'
import { run_board_render_section, type RuleColumn } from './run-board-render-section'
import { run_board_render_title } from './run-board-render-title'
import { run_board_seat } from './run-board-seat'
import type { LaneUsages, UsageFigure, UsageScale } from './run-board-usage'
import { run_board_usage_text, type CellLimits } from './run-board-usage-text'

// The run's own rows' CPU, MEM and CMPRS cells, right after each row's lead and before its number,
// under a rule whose labels stand over them and over the run's time: `── 🧵 lanes ── ⏰ ── 💪 CPU ─
// 🧠 MEM ─ 🤏 CMPRS ───`. The cells start at `USAGE_START`, as the processes rows' do, so the two
// sections' figures stand in one column (joshuafolkken/kit#4292). A running row draws its lane's
// figures; every other row blanks of the same width, so every number and title after them starts in
// one column. Drawn with gauges on a terminal and as figures alone anywhere else.

const { HEADER_ICONS } = run_board_labels
const { cell_widths, cells_of, lane_limits } = run_board_usage_text
const { columns_rule } = run_board_render_section
const { ELAPSED_START, LANES_LABEL, USAGE_START, column_offset, lane_label } = run_board_render_lead
const { width_of } = run_board_fit
const { columns_cut } = run_board_render_title
const { reasons_of } = run_board_seat
// A seat line's lead up to its icon: a lane row's indent, progress column and the blank after it.
const SEAT_LEAD_WIDTH = 5
const SEAT_LEAD = ' '.repeat(SEAT_LEAD_WIDTH)
const SEAT_ICON = '💺'
// A seat line ends the lanes section as a lane row does, so the section keeps it, and gives way
// before every running row in a short pane (`run-board-fit.ts`).
const SEAT_YIELD: RowYield = { stage: 'running', at_ms: undefined }
const GAUGE = 5
const CELL_GAP = ' '
// What a column needs past its label so the next label still has a rule before it: ` ─`.
const LABEL_TAIL = 2
// Icons Unicode draws as emoji by default, which `string-width` counts two columns wide as a
// terminal draws them: 🛤 and 🗜, text symbols drawn as emoji, overlapped the blank after them.
const COLUMN_LABELS = [`${HEADER_ICONS.cpu} CPU`, `${HEADER_ICONS.memory} MEM`, '🤏 CMPRS']

// What one frame's lane cells are drawn with.
interface LaneCells {
	usages: LaneUsages
	scale: UsageScale
	// Where each live row's gauges are full — its share of the header's yellow thresholds, counted once a
	// frame.
	limits: CellLimits
	gauge: number
	// The widest row number of the section, so the kind icon and title after it start in one column.
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

// A figure's cells, each right-aligned in its column — full at `limits` where a lane row passes its
// share, at the whole machine where not.
function column_cells(
	figure: UsageFigure | undefined,
	scale: UsageScale,
	gauge: number,
	limits?: CellLimits,
): string {
	const widths = column_widths(gauge)
	const cells = cells_of(figure, scale, gauge, limits).map(
		(cell, index) => `${' '.repeat(Math.max(0, (widths[index] ?? 0) - width_of(cell)))}${cell}`,
	)

	return cells.join(CELL_GAP)
}

// `undefined` where the frame read no usage, which draws no cells.
function lane_cells_of(header: BoardHeader, rows: ReadonlyArray<BoardRow>): LaneCells | undefined {
	const { usages } = header

	if (usages === undefined) return undefined

	const running = rows.filter((row) => run_board_earlier.is_live(row)).length

	return {
		usages: usages.lanes,
		scale: usages.scale,
		limits: lane_limits(running),
		gauge: gauge_of(header),
		number_width: Math.max(0, ...rows.map((row) => String(row.number).length)),
	}
}

// A row's number as linked — where cells are drawn, after them and padded to the section's widest.
function number_text(
	row: BoardRow,
	cells: LaneCells | undefined,
	link: (text: string) => string,
): string {
	const number = String(row.number)

	if (cells === undefined) return link(number)

	const figure = run_board_earlier.is_live(row) ? cells.usages.get(row.number) : undefined
	const drawn = column_cells(figure, cells.scale, cells.gauge, cells.limits)

	return `${drawn} ${link(number)}${' '.repeat(cells.number_width - number.length)}`
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

// A seat's reason, ending on an ellipsis at the pane's edge where it is wider, so the line keeps one
// line as a lane row's head does.
function seat_text(lead: string, reason: string, columns: number | undefined): string {
	const line = `${lead}${reason}`

	if (columns === undefined || width_of(line) <= columns) return line

	return `${lead}${columns_cut(reason, Math.max(1, columns - width_of(lead)))}`
}

// Each empty seat's reason (`run-board-seat.ts`), its icon in the column a lane row's phase icon
// stands in; a single run launches no lane, so it draws none.
function seat_lines(header: BoardHeader, columns: number | undefined): Array<PlanLine> {
	if (header.run_name !== undefined) return []

	const lead = `${' '.repeat(column_offset(header))}${SEAT_LEAD}${SEAT_ICON} `

	return reasons_of(header).map((reason) => ({
		text: seat_text(lead, reason, columns),
		row: SEAT_YIELD,
		is_seat: true,
	}))
}

// The run's own rows under the lanes rule, ⏰ over the run's time and the usage labels over their
// cells where they are drawn, then the empty seats' reasons.
function lanes_section(
	rows: ReadonlyArray<PlanLine>,
	cells: LaneCells | undefined,
	header: BoardHeader,
	columns?: number,
): Array<PlanSection> {
	const lines = [...rows, ...seat_lines(header, columns)]

	if (lines.length === 0) return []

	const offset = column_offset(header)
	const label = lane_label(header)
	const elapsed = { label: HEADER_ICONS.elapsed, start: ELAPSED_START + offset }
	const usage = cells === undefined ? [] : label_columns(USAGE_START + offset, cells.gauge)
	const rule = columns_rule(label, [elapsed, ...usage])

	return [{ head: ['', rule], lines, label, key: 'lanes' }]
}

const run_board_render_lanes = {
	COLUMN_LABELS,
	LANES_LABEL,
	column_cells,
	label_columns,
	lane_cells_of,
	lanes_section,
	number_text,
}

export { run_board_render_lanes }
export type { LaneCells }
