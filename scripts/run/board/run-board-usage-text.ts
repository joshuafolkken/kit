import { run_board_labels } from './run-board-labels'
import { run_board_machine } from './run-board-machine'
import type { LaneUsage } from './run-board-usage'

// A running row's CPU and memory column: `⚡ 20% 🧠1.6G`, each figure green, yellow or red in the
// header gauges' `GAUGE_SHADES`. **A lane's thresholds are its share of what the running lanes may
// use together**: the header's yellow threshold (`CPU_YELLOW` / `MEMORY_YELLOW`), never the whole
// machine — the OS, the IDE and the browser always hold some of it — divided by the running rows the
// frame draws. A lane turns yellow at three quarters of its share and red past the share itself — on
// an 18 GB machine at 3.2 and 4.2 GB with three lanes running, 1.2 and 1.6 GB with eight. One lane's
// share is the header's own threshold, so it takes no color the header gauge would not; a lane that
// ends widens the others' shares, and their colors may turn back.

const { GAUGE_SHADES, HEADER_ICONS, minute_of, painted } = run_board_labels
const { CPU_YELLOW, MEMORY_YELLOW, percent_text, threshold_alert } = run_board_machine
const YELLOW_OF_SHARE = 0.75
const BYTES_PER_KB = 1024
const BYTES_PER_GB = BYTES_PER_KB * BYTES_PER_KB * BYTES_PER_KB
const GB_DECIMALS = 1
const PART_GAP = ' '

type Shade = (typeof GAUGE_SHADES)[keyof typeof GAUGE_SHADES]

// A running lane's thresholds, in percent of the machine: its share of `pool_percent` among `running`.
function lane_thresholds(pool_percent: number, running: number): { yellow: number; red: number } {
	const share = pool_percent / Math.max(1, running)

	return { yellow: share * YELLOW_OF_SHARE, red: share }
}

function shade_of(percent: number, pool_percent: number, running: number): Shade {
	return GAUGE_SHADES[threshold_alert(percent, lane_thresholds(pool_percent, running))]
}

// The first sample has no CPU figure, so a row draws its memory alone until the second.
function cpu_part(cpu_percent: number | undefined, running: number): string | undefined {
	if (cpu_percent === undefined) return undefined

	const shade = shade_of(cpu_percent, CPU_YELLOW, running)

	return `${HEADER_ICONS.cpu}${painted(shade, percent_text(cpu_percent))}`
}

function memory_part(usage: LaneUsage, running: number): string {
	const figure = `${(usage.memory_bytes / BYTES_PER_GB).toFixed(GB_DECIMALS)}G`
	const shade = shade_of(usage.memory_percent, MEMORY_YELLOW, running)

	return `${HEADER_ICONS.memory}${painted(shade, figure)}`
}

// `undefined` for a lane no process was found under; `running` is the frame's running rows.
function text_of(usage: LaneUsage | undefined, running: number): string | undefined {
	if (usage === undefined) return undefined

	return [cpu_part(usage.cpu_percent, running), memory_part(usage, running)]
		.filter((part) => part !== undefined)
		.join(PART_GAP)
}

// The day a settled row finished, `10/8 `, where that is not the board's own day.
function day_of(ended_ms: number, now_ms: number): string {
	const ended = new Date(ended_ms)

	if (ended.toDateString() === new Date(now_ms).toDateString()) return ''

	return `${String(ended.getMonth() + 1)}/${String(ended.getDate())} `
}

// A settled row's finish time, drawn in the usage column: `🔚 14:05`, or
// `🔚 10/8 14:05` on another day; `undefined` for a row settled with no recorded end. 🔚 is the
// header's own end mark — 🏁 is already a done row's state icon.
function finish_of(ended_ms: number | undefined, now_ms: number): string | undefined {
	if (ended_ms === undefined) return undefined

	return `${HEADER_ICONS.ended} ${day_of(ended_ms, now_ms)}${minute_of(ended_ms)}`
}

const run_board_usage_text = { finish_of, lane_thresholds, text_of }

export { run_board_usage_text }
