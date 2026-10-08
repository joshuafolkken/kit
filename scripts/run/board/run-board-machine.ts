import { styleText } from 'node:util'
import { machine_capacity, type MachineSample } from '#scripts/gate/machine-capacity'
import { run_board_labels } from './run-board-labels'

// The machine line of `run:board` (joshuafolkken/kit#3450): whether a quiet run is stuck or only slow
// on a machine that has run out of room. On 2026-10-07 three lanes reached a load average of 16.8 and
// swapped 4.4 GB, and the board showed none of it.
//
// **The reading is the gate's own** (`machine-capacity.ts`), so the board shows what the core budget
// admits against. 🔥 is the busy share of the CPU between two samples; 🧠 the kernel's memory pressure,
// never a GB figure that would disagree with Activity Monitor's "memory used"; 💾 how fast pages are
// swapped, never how much swap is held — macOS grows its swap files, so a usage share reads near 100%
// and the amount itself does no harm. A figure that needs two samples is not drawn on the first, and a
// figure that could not be read is not drawn at all.

const { HEADER_ICONS, bar_of } = run_board_labels
const PERCENT = 100
const MS_PER_SECOND = 1000
const PERCENT_WIDTH = '100%'.length
const RATE_WIDTH = '3.1M/s'.length
// Below this a rate keeps one decimal, so `0.4M/s` is not drawn as `0M/s`.
const RATE_DECIMAL_BELOW = 10
// The title line's gap, so the gauges sit under its parts.
const GAUGE_GAP_WIDTH = 3
const GAUGE_GAP = ' '.repeat(GAUGE_GAP_WIDTH)

// Where each gauge is full and where it turns yellow and red. **Provisional, not yet measured**: set
// from the 2026-10-07 incident and to be tuned against a heavy run's readings.
const CPU_YELLOW = 70
const CPU_RED = 90
const MEMORY_YELLOW = 70
const MEMORY_RED = 85
const SWAP_FULL_MB_PER_S = 20
const SWAP_RED_MB_PER_S = 10

// One sample and the moment it was taken, so a rate is over the time that really passed.
interface MachineMark {
	sample: MachineSample
	at_ms: number
}

interface MachineGauges {
	cpu_percent: number | undefined
	memory_percent: number | undefined
	swap_mb_per_s: number | undefined
}

interface GaugeSpec {
	icon: string
	full: number
	yellow: number
	red: number
	format: (value: number) => string
}

function percent_text(value: number): string {
	return `${String(Math.round(value))}%`.padStart(PERCENT_WIDTH)
}

function rate_text(value: number): string {
	const figure = value < RATE_DECIMAL_BELOW ? value.toFixed(1) : String(Math.round(value))

	return `${figure}M/s`.padStart(RATE_WIDTH)
}

const SPECS = {
	cpu: {
		icon: HEADER_ICONS.cpu,
		full: PERCENT,
		yellow: CPU_YELLOW,
		red: CPU_RED,
		format: percent_text,
	},
	memory: {
		icon: HEADER_ICONS.memory,
		full: PERCENT,
		yellow: MEMORY_YELLOW,
		red: MEMORY_RED,
		format: percent_text,
	},
	swap: {
		icon: HEADER_ICONS.swap,
		full: SWAP_FULL_MB_PER_S,
		yellow: 1,
		red: SWAP_RED_MB_PER_S,
		format: rate_text,
	},
} as const satisfies Readonly<Record<string, GaugeSpec>>

function cpu_percent(before: MachineMark | undefined, after: MachineMark): number | undefined {
	if (before === undefined) return undefined

	const share = machine_capacity.busy_share_between(before.sample.cpu, after.sample.cpu)

	return share === undefined ? undefined : share * PERCENT
}

function memory_percent(sample: MachineSample): number | undefined {
	const { available_mb } = sample.memory

	return available_mb === undefined
		? undefined
		: PERCENT - (available_mb / sample.total_mb) * PERCENT
}

// A counter that went back — a reboot between samples — is read as nothing swapped.
function swapped_between(before: MachineMark, after: MachineMark): number | undefined {
	const from = before.sample.memory.swapped_mb
	const to = after.sample.memory.swapped_mb

	if (from === undefined || to === undefined) return undefined

	return Math.max(0, to - from)
}

function swap_rate(before: MachineMark | undefined, after: MachineMark): number | undefined {
	if (before === undefined) return undefined

	const swapped = swapped_between(before, after)
	const seconds = (after.at_ms - before.at_ms) / MS_PER_SECOND

	return swapped === undefined || seconds <= 0 ? undefined : swapped / seconds
}

function gauges_of(before: MachineMark | undefined, after: MachineMark): MachineGauges {
	return {
		cpu_percent: cpu_percent(before, after),
		memory_percent: memory_percent(after.sample),
		swap_mb_per_s: swap_rate(before, after),
	}
}

function colored(text: string, value: number, spec: GaugeSpec): string {
	if (value >= spec.red) return styleText('red', text)

	return value >= spec.yellow ? styleText('yellow', text) : text
}

// The bar stops full past `spec.full`; the figure beside it still says how far past.
function gauge(spec: GaugeSpec, value: number | undefined): string | undefined {
	if (value === undefined) return undefined

	const body = [bar_of(value, spec.full), spec.format(value)].join(' ')

	return `${spec.icon} ${colored(body, value, spec)}`
}

// `undefined` when not one gauge could be read, so the header draws no line at all.
function line_of(gauges: MachineGauges | undefined): string | undefined {
	if (gauges === undefined) return undefined

	const parts = [
		gauge(SPECS.cpu, gauges.cpu_percent),
		gauge(SPECS.memory, gauges.memory_percent),
		gauge(SPECS.swap, gauges.swap_mb_per_s),
	].filter((part) => part !== undefined)

	return parts.length === 0 ? undefined : parts.join(GAUGE_GAP)
}

const run_board_machine = { gauges_of, line_of }

export { run_board_machine }
export type { MachineGauges, MachineMark }
