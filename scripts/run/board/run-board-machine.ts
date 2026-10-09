import { machine_capacity, type MachineSample } from '#scripts/gate/machine-capacity'
import { run_board_labels, type Paint } from './run-board-labels'

// The machine line of `run:board`: whether a quiet run is stuck or only slow on a machine that has
// run out of room.
//
// **The reading is the gate's own** (`machine-capacity.ts`), so the board shows what the core budget
// admits against. 🔥 is the busy share of the CPU between two samples; 🧠 the kernel's memory pressure,
// never a GB figure that would disagree with Activity Monitor's "memory used"; 💾 how fast pages are
// swapped, never how much swap is held — macOS grows its swap files, so a usage share reads near 100%
// and the amount itself does no harm. A figure that needs two samples is not drawn on the first, and a
// figure that could not be read is not drawn at all.
//
// **Each gauge is green, yellow or red**, the three Activity Monitor draws. 🧠 takes its color from
// the kernel's pressure verdict, as Activity Monitor does, and from its thresholds only where no
// verdict was read; 💾 takes no color until it swaps. The three are `GAUGE_SHADES`, so no terminal
// palette draws them blue or orange.

const { GAUGE_SHADES, HEADER_ICONS, bar_of, painted } = run_board_labels
const PERCENT = 100
const MS_PER_SECOND = 1000
const PERCENT_WIDTH = '100%'.length
const RATE_WIDTH = '3.1M/s'.length
// Below this a rate keeps one decimal, so `0.4M/s` is not drawn as `0M/s`.
const RATE_DECIMAL_BELOW = 10
// The header's gap between its parts, the gauges' as well.
const GAP = '  '

// Where each gauge is full and where it turns yellow and red. **Provisional, not yet measured**: to
// be tuned against a heavy run's readings.
const CPU_YELLOW = 70
const CPU_RED = 90
const MEMORY_YELLOW = 70
const MEMORY_RED = 85
const SWAP_FULL_MB_PER_S = 20
const SWAP_RED_MB_PER_S = 10

type Alert = 'normal' | 'yellow' | 'red'

// `kern.memorystatus_vm_pressure_level`'s verdicts.
const PRESSURE_NORMAL = 1
const PRESSURE_WARNING = 2
const PRESSURE_CRITICAL = 4
const PRESSURE_ALERTS: ReadonlyMap<number, Alert> = new Map([
	[PRESSURE_NORMAL, 'normal'],
	[PRESSURE_WARNING, 'yellow'],
	[PRESSURE_CRITICAL, 'red'],
])

// One sample and the moment it was taken, so a rate is over the time that really passed.
interface MachineMark {
	sample: MachineSample
	at_ms: number
}

interface MachineGauges {
	cpu_percent: number | undefined
	memory_percent: number | undefined
	swap_mb_per_s: number | undefined
	memory_pressure: number | undefined
}

interface GaugeSpec {
	icon: string
	// The done part's color below the yellow threshold; `undefined` leaves it the terminal's own.
	normal: Paint | undefined
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
		normal: GAUGE_SHADES.normal,
		full: PERCENT,
		yellow: CPU_YELLOW,
		red: CPU_RED,
		format: percent_text,
	},
	memory: {
		icon: HEADER_ICONS.memory,
		normal: GAUGE_SHADES.normal,
		full: PERCENT,
		yellow: MEMORY_YELLOW,
		red: MEMORY_RED,
		format: percent_text,
	},
	swap: {
		icon: HEADER_ICONS.swap,
		normal: undefined,
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
		memory_pressure: after.sample.memory.pressure_level,
	}
}

function threshold_alert(value: number, spec: Pick<GaugeSpec, 'red' | 'yellow'>): Alert {
	if (value >= spec.red) return 'red'

	return value >= spec.yellow ? 'yellow' : 'normal'
}

// A pressure verdict the kernel gave decides the color; an unread or unknown one falls to the thresholds.
function alert_of(spec: GaugeSpec, value: number, pressure: number | undefined): Alert {
	const verdict = pressure === undefined ? undefined : PRESSURE_ALERTS.get(pressure)

	return verdict ?? threshold_alert(value, spec)
}

// Icon, figure, then bar: the figure is what a person reads, and its fixed
// width keeps every bar starting in one column. The bar stops full past `spec.full`; the figure still
// says how far past, and takes the warning colors only, so a quiet machine's figures stay the terminal's
// own.
function gauge(spec: GaugeSpec, value: number | undefined, pressure?: number): string | undefined {
	if (value === undefined) return undefined

	const alert = alert_of(spec, value, pressure)
	const warning = alert === 'normal' ? undefined : GAUGE_SHADES[alert]
	const bar = bar_of(value, spec.full, undefined, warning ?? spec.normal)

	return `${spec.icon} ${painted(warning, spec.format(value))} ${bar}`
}

// `undefined` when not one gauge could be read, so the header draws no line at all.
function line_of(gauges: MachineGauges | undefined): string | undefined {
	if (gauges === undefined) return undefined

	const parts = [
		gauge(SPECS.cpu, gauges.cpu_percent),
		gauge(SPECS.memory, gauges.memory_percent, gauges.memory_pressure),
		gauge(SPECS.swap, gauges.swap_mb_per_s),
	].filter((part) => part !== undefined)

	return parts.length === 0 ? undefined : parts.join(GAP)
}

const run_board_machine = {
	CPU_YELLOW,
	GAP,
	MEMORY_YELLOW,
	gauges_of,
	line_of,
	percent_text,
	threshold_alert,
}

export { run_board_machine }
export type { Alert, MachineGauges, MachineMark }
