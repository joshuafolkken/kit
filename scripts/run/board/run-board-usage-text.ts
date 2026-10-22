import { run_board_labels } from './run-board-labels'
import { run_board_machine } from './run-board-machine'
import type { UsageFigure, UsageScale } from './run-board-usage'

// The CPU, memory and compressed-memory cells a lane row and a processes row draw: each a figure and a
// gauge, `16.4 ■─────` / ` 0.7 ■────`, a processes row's gauge full at the whole machine — the header's
// 💪 and 🧠 scale — a lane row's at its share (joshuafolkken/kit#4546), and its color the header gauges' own `GAUGE_SHADES`. CPU is a percentage of the whole
// machine, the header's 💪 unit, and memory is in GB; the column labels name neither unit.
//
// **A processes row is shaded at the header's thresholds; a lane row at its share of what the running
// lanes may use together** (joshuafolkken/kit#3612): the header's yellow threshold (`CPU_YELLOW` /
// `MEMORY_YELLOW`), never the whole machine — the OS, the IDE and the browser always hold some of it —
// divided by the running rows the frame draws. A lane turns yellow at three quarters of its share and
// red past the share itself — with one lane running at 52.5% and 70% of the machine, with two at
// 26.25% and 35%. A lane that ends widens the others' shares, and their colors may turn back.

const { GAUGE_SHADES, bar_of } = run_board_labels
const { CPU_RED, CPU_YELLOW, MEMORY_RED, MEMORY_YELLOW, threshold_alert } = run_board_machine
const YELLOW_OF_SHARE = 0.75
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

interface Thresholds {
	yellow: number
	red: number
}

// Where a row's cells turn yellow and red, in percent of the machine: the CPU's, then both memories'.
// `is_full_at_red` draws a gauge full at its red line rather than at the whole machine.
interface CellLimits {
	cpu: Thresholds
	memory: Thresholds
	is_full_at_red: boolean
}

const MACHINE_LIMITS: CellLimits = {
	cpu: { yellow: CPU_YELLOW, red: CPU_RED },
	memory: { yellow: MEMORY_YELLOW, red: MEMORY_RED },
	is_full_at_red: false,
}

// The color is read against `total`, the whole machine; the gauge is drawn full at `full`.
interface Cell {
	text: string | undefined
	value: number
	total: number
	full: number
	thresholds: Thresholds
}

interface CellScale {
	total: number
	thresholds: Thresholds
	is_full_at_red: boolean
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

function cell_text(cell: Cell, width: number, gauge: number): string {
	if (cell.text === undefined) return CELL_GAP.repeat(width + gauge_width(gauge))

	const figure = cell.text.padStart(width)

	if (gauge === 0) return figure

	const shade = GAUGE_SHADES[threshold_alert(share_of(cell.value, cell.total), cell.thresholds)]

	return `${figure}${CELL_GAP}${bar_of(cell.value, cell.full, gauge, shade)}`
}

// A running lane's thresholds, in percent of the machine: its share of `pool_percent` among `running`.
function lane_thresholds(pool_percent: number, running: number): Thresholds {
	const share = pool_percent / Math.max(1, running)

	return { yellow: share * YELLOW_OF_SHARE, red: share }
}

// A lane row's limits with `running` lanes drawn: each its share of the header's yellow threshold, its
// gauge full at the share so the length agrees with the color (joshuafolkken/kit#4546).
function lane_limits(running: number): CellLimits {
	return {
		cpu: lane_thresholds(CPU_YELLOW, running),
		memory: lane_thresholds(MEMORY_YELLOW, running),
		is_full_at_red: true,
	}
}

function cell_of(text: string | undefined, value: number, scale: CellScale): Cell {
	const { total, thresholds, is_full_at_red } = scale
	const full = is_full_at_red ? (total * thresholds.red) / PERCENT : total

	return { text, value, total, full, thresholds }
}

function cells_from(figure: UsageFigure, scale: UsageScale, limits: CellLimits): Array<Cell> {
	const { cpu_cores, memory_bytes, compressed_bytes } = figure
	const { cpu, memory, is_full_at_red } = limits
	const cores = { total: scale.cores, thresholds: cpu, is_full_at_red }
	const bytes = { total: scale.total_bytes, thresholds: memory, is_full_at_red }

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
// Shaded and filled at `limits`, the whole machine's unless a lane row passes its share.
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
	lane_thresholds,
	plain_of,
}

export { run_board_usage_text }
export type { CellLimits }
