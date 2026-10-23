import { run_board_labels } from './run-board-labels'
import { run_board_machine, type Alert } from './run-board-machine'
import type { UsageFigure, UsageScale } from './run-board-usage'

// The CPU, memory and compressed-memory cells a lane row and a processes row draw: each a figure and a
// gauge, `16.4 ■─────` / ` 0.7 ■────`, a processes row's gauge full at the whole machine — the header's
// 💪 and 🧠 scale — a lane row's at its share (joshuafolkken/kit#4546), and its color the header gauges' own `GAUGE_SHADES`. CPU is a percentage of the whole
// machine, the header's 💪 unit, and memory is in GB; the column labels name neither unit.
//
// **A lane row's gauge is full at its share of what the running lanes may use together**
// (joshuafolkken/kit#3612): the header's yellow threshold (`CPU_YELLOW` / `MEMORY_YELLOW`), never the
// whole machine — the OS, the IDE and the browser always hold some of it — divided by the running rows
// the frame draws. A lane that ends widens the others' shares, and their gauges may shrink.
//
// **Both rows are shaded at the same two points of their full gauge** (joshuafolkken/kit#4570): yellow
// past half, red past nine tenths, so the third cell reads yellow and the fifth red. The header's own
// thresholds shade the header alone.

const { GAUGE_SHADES, bar_of } = run_board_labels
const { CPU_YELLOW, MEMORY_YELLOW } = run_board_machine
const ROW_YELLOW_OF_FULL = 50
const ROW_RED_OF_FULL = 90
const BYTES_PER_KB = 1024
const BYTES_PER_GB = BYTES_PER_KB * BYTES_PER_KB * BYTES_PER_KB
const PERCENT = 100
const DECIMALS = 1
const FIGURE_WIDTH = '99.9'.length
const GB_UNIT = 'G'
const PERCENT_UNIT = '%'
const CELL_GAP = ' '
const PLAIN_GAP = '/'
const NO_CORES = '-'

// Where a row's gauges are full, in percent of the machine: the CPU's, then both memories'.
interface CellLimits {
	cpu: number
	memory: number
}

const MACHINE_LIMITS: CellLimits = { cpu: PERCENT, memory: PERCENT }

// The gauge is drawn full at `full`, and shaded at its fill.
interface Cell {
	text: string | undefined
	value: number
	full: number
}

function gigabytes(bytes: number): string {
	return (bytes / BYTES_PER_GB).toFixed(DECIMALS)
}

function share_of(value: number, full: number): number {
	return full === 0 ? 0 : (value / full) * PERCENT
}

// The cores as a percentage of the machine's, `56.4`; a full machine is `100`, so the figure stays as
// wide as `99.9`.
function cpu_text(cores: number | undefined, scale: UsageScale): string | undefined {
	if (cores === undefined) return undefined

	const text = share_of(cores, scale.cores).toFixed(DECIMALS)

	return Number(text) >= PERCENT ? String(PERCENT) : text
}

// The columns a gauge takes after its figure — none where no gauge is drawn.
function gauge_width(gauge: number): number {
	return gauge === 0 ? 0 : CELL_GAP.length + gauge
}

// A row gauge's color at `percent` of its full: yellow past half, red past nine tenths, each line itself
// still the color below it.
function row_alert(percent: number): Alert {
	if (percent > ROW_RED_OF_FULL) return 'red'

	return percent > ROW_YELLOW_OF_FULL ? 'yellow' : 'normal'
}

function cell_text(cell: Cell, width: number, gauge: number): string {
	if (cell.text === undefined) return CELL_GAP.repeat(width + gauge_width(gauge))

	const figure = cell.text.padStart(width)

	if (gauge === 0) return figure

	const shade = GAUGE_SHADES[row_alert(share_of(cell.value, cell.full))]

	return `${figure}${CELL_GAP}${bar_of(cell.value, cell.full, gauge, shade)}`
}

// A running lane's share, in percent of the machine: `pool_percent` divided among `running`.
function lane_share(pool_percent: number, running: number): number {
	return pool_percent / Math.max(1, running)
}

// A lane row's limits with `running` lanes drawn: each gauge full at its share of the header's yellow
// threshold (joshuafolkken/kit#4546).
function lane_limits(running: number): CellLimits {
	return { cpu: lane_share(CPU_YELLOW, running), memory: lane_share(MEMORY_YELLOW, running) }
}

function cell_of(text: string | undefined, value: number, full: number): Cell {
	return { text, value, full }
}

function cells_from(figure: UsageFigure, scale: UsageScale, limits: CellLimits): Array<Cell> {
	const { cpu_cores, memory_bytes, compressed_bytes } = figure
	const cores = (scale.cores * limits.cpu) / PERCENT
	const bytes = (scale.total_bytes * limits.memory) / PERCENT

	return [
		cell_of(cpu_text(cpu_cores, scale), cpu_cores ?? 0, cores),
		cell_of(gigabytes(memory_bytes), memory_bytes, bytes),
		cell_of(gigabytes(compressed_bytes), compressed_bytes, bytes),
	]
}

// Each cell's width before its gauge: the CPU's text, then the two memories'.
function text_widths(): Array<number> {
	return [FIGURE_WIDTH, FIGURE_WIDTH, FIGURE_WIDTH]
}

// Each cell's width in columns, so a heading can put a column's label over it.
function cell_widths(gauge: number): Array<number> {
	return text_widths().map((width) => width + gauge_width(gauge))
}

// The CPU, MEM and CMPRS cells, each `gauge` columns of bar after its figure — the figure alone at a
// `gauge` of 0, where a frame is not drawn on a terminal; a row with no figure, or
// a figure from the first sample with no CPU yet, draws blanks of the same width in the cell it lacks.
// Filled and shaded at `limits`, the whole machine's unless a lane row passes its share.
function cells_of(
	figure: UsageFigure | undefined,
	scale: UsageScale,
	gauge: number,
	limits: CellLimits = MACHINE_LIMITS,
): Array<string> {
	if (figure === undefined) return cell_widths(gauge).map((width) => CELL_GAP.repeat(width))

	const widths = text_widths()

	return cells_from(figure, scale, limits).map((cell, index) =>
		cell_text(cell, widths[index] ?? 0, gauge),
	)
}

// A figure on one line where no gauge is drawn, and so no column label names the units:
// `56.4%/0.7G/0.6G`, `-` for cores not read yet.
function plain_of(figure: UsageFigure, scale: UsageScale): string {
	const cpu = cpu_text(figure.cpu_cores, scale)
	const memories = [figure.memory_bytes, figure.compressed_bytes].map(
		(bytes) => `${gigabytes(bytes)}${GB_UNIT}`,
	)

	return [cpu === undefined ? NO_CORES : `${cpu}${PERCENT_UNIT}`, ...memories].join(PLAIN_GAP)
}

const run_board_usage_text = {
	cell_widths,
	cells_of,
	lane_limits,
	lane_share,
	plain_of,
}

export { run_board_usage_text }
export type { CellLimits }
