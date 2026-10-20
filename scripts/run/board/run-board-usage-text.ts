import { run_board_labels } from './run-board-labels'
import { run_board_machine } from './run-board-machine'
import type { UsageFigure, UsageScale } from './run-board-usage'

// The CPU, memory and compressed-memory cells a lane row and a processes row draw: each a figure and a
// gauge, `16.4 ■─────` / ` 0.7 ■────`, the gauge's full width the whole machine — the header's 💪 and
// 🧠 scale — and its color the header gauges' own `GAUGE_SHADES` at the header's thresholds, so a
// row reads against the same machine the header does. CPU is a percentage of the whole machine, the
// header's 💪 unit, and memory is in GB; the column labels name neither unit.

const { GAUGE_SHADES, HEADER_ICONS, bar_of, minute_of } = run_board_labels
const { CPU_RED, CPU_YELLOW, MEMORY_RED, MEMORY_YELLOW, threshold_alert } = run_board_machine
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

interface Cell {
	text: string | undefined
	value: number
	full: number
	thresholds: { yellow: number; red: number }
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

	const shade = GAUGE_SHADES[threshold_alert(share_of(cell.value, cell.full), cell.thresholds)]

	return `${figure}${CELL_GAP}${bar_of(cell.value, cell.full, gauge, shade)}`
}

function cells_from(figure: UsageFigure, scale: UsageScale): Array<Cell> {
	const memory = { yellow: MEMORY_YELLOW, red: MEMORY_RED }
	const { cpu_cores, memory_bytes, compressed_bytes } = figure

	return [
		{
			text: cpu_text(cpu_cores, scale),
			value: cpu_cores ?? 0,
			full: scale.cores,
			thresholds: { yellow: CPU_YELLOW, red: CPU_RED },
		},
		{
			text: gigabytes(memory_bytes),
			value: memory_bytes,
			full: scale.total_bytes,
			thresholds: memory,
		},
		{
			text: gigabytes(compressed_bytes),
			value: compressed_bytes,
			full: scale.total_bytes,
			thresholds: memory,
		},
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
function cells_of(
	figure: UsageFigure | undefined,
	scale: UsageScale,
	gauge: number,
): Array<string> {
	if (figure === undefined) return cell_widths(gauge).map((width) => CELL_GAP.repeat(width))

	const widths = text_widths()

	return cells_from(figure, scale).map((cell, index) => cell_text(cell, widths[index] ?? 0, gauge))
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

// The day a settled row finished, `10/8 `, where that is not the board's own day.
function day_of(ended_ms: number, now_ms: number): string {
	const ended = new Date(ended_ms)

	if (ended.toDateString() === new Date(now_ms).toDateString()) return ''

	return `${String(ended.getMonth() + 1)}/${String(ended.getDate())} `
}

// A settled row's finish time, drawn after its time: `🔚 14:05`, or `🔚 10/8 14:05` on another day;
// `undefined` for a row settled with no recorded end. 🔚 is the header's own end mark — 🏁 is already a
// done row's state icon.
function finish_of(ended_ms: number | undefined, now_ms: number): string | undefined {
	if (ended_ms === undefined) return undefined

	return `${HEADER_ICONS.ended} ${day_of(ended_ms, now_ms)}${minute_of(ended_ms)}`
}

const run_board_usage_text = { cell_widths, cells_of, finish_of, plain_of }

export { run_board_usage_text }
