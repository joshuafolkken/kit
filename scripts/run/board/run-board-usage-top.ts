import { execa } from 'execa'
import { run_board_held } from './run-board-held'

// Each process's memory and compressed memory as `top`'s MEM and CMPRS count them — the columns
// Activity Monitor's "Memory" and "Compressed Memory" show. Compressed pages are what a resident set
// leaves out: `eslint_d` holds about 28 MB resident against 1 GB in `top`'s MEM (joshuafolkken/kit#4171).
// **CMPRS has no cheaper reader**: `proc_pid_rusage` carries the footprint (MEM) but no compressed
// count, and `top -l 1` costs about 1.1 s of system CPU against `ps`'s 30 ms. So `top` runs at most once
// every 30 s, in the background, and the board draws the last reading; only the very first read waits.

const TOP_ARGUMENTS = ['-l', '1', '-F', '-R', '-stats', 'pid,mem,cmprs']
const TOP_INTERVAL_MS = 30_000
// `top -l 1` samples for about a second and lists every process; `PROBE_TIMEOUT_MS` is sized for `ps`.
const TOP_TIMEOUT_MS = 10_000
const BYTES_PER_UNIT = 1024
// `top`'s size units, each 1024 times the one before.
const SIZE_UNITS = ['B', 'K', 'M', 'G', 'T']
// A size such as `3904K`, `154M+` or `1.2G-` — the sign marks a change since the last sample.
const SIZE_PATTERN = /^(\d+(?:\.\d+)?)([BKMGT])[+-]?$/u
const TOP_LINE = /^\s*(\d+)\s+(\S+)\s+(\S+)\s*$/u

interface TopReading {
	memory_bytes: number
	compressed_bytes: number
}

// Each process's `top` reading by its pid.
type TopReadings = ReadonlyMap<number, TopReading>

interface TopPorts {
	// `top`'s one-sample listing.
	list: () => Promise<string>
	now: () => number
}

// `NaN` for a field that is not a size, such as the `MEM` column heading.
function bytes_of(text = ''): number {
	const [, amount, unit = ''] = SIZE_PATTERN.exec(text) ?? []

	return Number(amount) * BYTES_PER_UNIT ** SIZE_UNITS.indexOf(unit)
}

function top_line(line: string): [number, TopReading] | undefined {
	const [, pid, memory, compressed] = TOP_LINE.exec(line) ?? []
	const reading = { memory_bytes: bytes_of(memory), compressed_bytes: bytes_of(compressed) }

	if (Number.isNaN(reading.memory_bytes + reading.compressed_bytes)) return undefined

	return [Number(pid), reading]
}

function parse_top(output: string): Map<number, TopReading> {
	const lines = output.split('\n').map((line) => top_line(line))

	return new Map(lines.filter((line) => line !== undefined))
}

// The last reading, with a fresh `top` started in the background once it is `TOP_INTERVAL_MS` old;
// only the first read, which has none to draw, waits for it. A read that fails keeps the earlier
// readings, and an empty map where there were none.
function top_reader(ports: TopPorts): () => Promise<TopReadings> {
	return run_board_held.held_reader<TopReadings>({
		read: async () => parse_top(await ports.list()),
		now: ports.now,
		interval_ms: TOP_INTERVAL_MS,
		fallback: new Map(),
	})
}

async function list_top(): Promise<string> {
	const { stdout } = await execa('top', TOP_ARGUMENTS, { timeout: TOP_TIMEOUT_MS })

	return stdout
}

const run_board_usage_top = { TOP_INTERVAL_MS, TOP_TIMEOUT_MS, list_top, parse_top, top_reader }

export { run_board_usage_top }
export type { TopPorts, TopReading, TopReadings }
