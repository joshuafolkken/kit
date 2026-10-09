import { run_board_labels } from './run-board-labels'
import { run_board_machine } from './run-board-machine'
import type { LaneUsage } from './run-board-usage'

// A running row's CPU and memory column (joshuafolkken/kit#3489): `⚡ 20% 🧠1.6G`, each figure green,
// yellow or red in the header gauges' `GAUGE_SHADES`. **A lane has its own thresholds**: the header's
// 70% and 90% are the whole machine's, which one lane never reaches, so its colors would never turn. A
// lane turns yellow at a fifth of the machine and red at two fifths — on an 11-core, 18 GB machine about
// 2.2 and 4.4 cores, 3.6 and 7.2 GB.

const { GAUGE_SHADES, HEADER_ICONS, painted } = run_board_labels
const { percent_text, threshold_alert } = run_board_machine
const LANE_THRESHOLDS = { yellow: 20, red: 40 } as const
const BYTES_PER_KB = 1024
const BYTES_PER_GB = BYTES_PER_KB * BYTES_PER_KB * BYTES_PER_KB
const GB_DECIMALS = 1
const PART_GAP = ' '

function shade_of(percent: number): (typeof GAUGE_SHADES)[keyof typeof GAUGE_SHADES] {
	return GAUGE_SHADES[threshold_alert(percent, LANE_THRESHOLDS)]
}

// The first sample has no CPU figure, so a row draws its memory alone until the second.
function cpu_part(cpu_percent: number | undefined): string | undefined {
	if (cpu_percent === undefined) return undefined

	return `${HEADER_ICONS.cpu}${painted(shade_of(cpu_percent), percent_text(cpu_percent))}`
}

function memory_part(usage: LaneUsage): string {
	const figure = `${(usage.memory_bytes / BYTES_PER_GB).toFixed(GB_DECIMALS)}G`

	return `${HEADER_ICONS.memory}${painted(shade_of(usage.memory_percent), figure)}`
}

// `undefined` for a lane no process was found under.
function text_of(usage: LaneUsage | undefined): string | undefined {
	if (usage === undefined) return undefined

	return [cpu_part(usage.cpu_percent), memory_part(usage)]
		.filter((part) => part !== undefined)
		.join(PART_GAP)
}

const run_board_usage_text = { text_of }

export { run_board_usage_text }
