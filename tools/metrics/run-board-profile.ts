// Where a `run:board` tick spends its time and memory (#7257): each read a live board takes, run
// `runs` times in this process, with its wall time, this process's CPU time and the heap it grew by.
// A read's cost per minute is its cost per call times how often the live board takes it, which is
// what decides the read a later change should make cheaper. A child process's own CPU (`sysctl`,
// `ps`, `git`, `top`) is not this process's, so it is not counted here.

const KIB = 1024
const MIB = KIB * KIB
const DECIMALS = 2
const US_PER_MS = 1000
const DEFAULT_RUNS = 20
const UNATTRIBUTED_LABEL = 'round minus its parts'
const HEADER = ['read', 'calls/min', 'wall ms', 'cpu ms', 'cpu ms/min', 'heap KiB', 'heap MiB/min']

interface ProfilePorts {
	now: () => number
	cpu_ms: () => number
	heap_bytes: () => number
	// A full collection before each read, where the process allows one, so the growth is the read's.
	settle?: (() => void) | undefined
}

const LIVE_PORTS: ProfilePorts = {
	now: () => performance.now(),
	cpu_ms: () => {
		const { user, system } = process.cpuUsage()

		return (user + system) / US_PER_MS
	},
	heap_bytes: () => {
		const usage = process.memoryUsage()

		return usage.heapUsed + usage.external
	},
	// A no-op where the process was started without `--expose-gc`.
	settle: () => {
		globalThis.gc?.()
	},
}

// The runs asked for, or the default where the argument is not a positive whole number: no run would
// leave nothing to average, and a count that never reaches zero would never end.
function runs_of(argument: string | undefined): number {
	const runs = Number(argument)

	return Number.isSafeInteger(runs) && runs > 0 ? runs : DEFAULT_RUNS
}

// A piece's place in the worker round (#8136): the whole round, or a read the round makes directly. A
// piece with no role is outside the round (the redraw) or a share of a part (the ledger read inside
// the local read), so counting it again would hide what the parts leave out.
type Role = 'part' | 'whole'

interface Piece {
	label: string
	per_minute: number
	run: () => Promise<unknown>
	role?: Role | undefined
}

interface Sample {
	label: string
	per_minute: number
	wall_ms: number
	cpu_ms: number
	heap_bytes: number
	role?: Role | undefined
}

async function repeat(run: () => Promise<unknown>, times: number): Promise<void> {
	if (times <= 0) return

	await run()
	await repeat(run, times - 1)
}

async function measure(piece: Piece, runs: number, ports: ProfilePorts): Promise<Sample> {
	ports.settle?.()
	const start = { wall: ports.now(), cpu: ports.cpu_ms(), heap: ports.heap_bytes() }

	await repeat(piece.run, runs)

	return {
		label: piece.label,
		per_minute: piece.per_minute,
		wall_ms: (ports.now() - start.wall) / runs,
		cpu_ms: (ports.cpu_ms() - start.cpu) / runs,
		heap_bytes: (ports.heap_bytes() - start.heap) / runs,
		role: piece.role,
	}
}

async function measure_all(
	pieces: ReadonlyArray<Piece>,
	runs: number,
	ports: ProfilePorts,
): Promise<Array<Sample>> {
	const samples: Array<Sample> = []

	for (const piece of pieces) {
		// eslint-disable-next-line no-await-in-loop -- reads run one at a time, so no read's cost lands in another's
		samples.push(await measure(piece, runs, ports))
	}

	return samples
}

function cpu_per_minute(sample: Sample): number {
	return sample.cpu_ms * sample.per_minute
}

function row_of(sample: Sample): Array<string> {
	return [
		sample.label,
		String(sample.per_minute),
		sample.wall_ms.toFixed(DECIMALS),
		sample.cpu_ms.toFixed(DECIMALS),
		cpu_per_minute(sample).toFixed(DECIMALS),
		(sample.heap_bytes / KIB).toFixed(DECIMALS),
		((sample.heap_bytes * sample.per_minute) / MIB).toFixed(DECIMALS),
	]
}

function line_of(cells: ReadonlyArray<string>): string {
	return `| ${cells.join(' | ')} |`
}

// The round's CPU per minute its parts do not account for, or none where no whole round was measured.
function unattributed_rows(samples: ReadonlyArray<Sample>): Array<Array<string>> {
	const whole = samples.find((sample) => sample.role === 'whole')

	if (whole === undefined) return []

	const parts = samples.filter((sample) => sample.role === 'part')
	const left = parts.reduce((sum, part) => sum - cpu_per_minute(part), cpu_per_minute(whole))

	return [[UNATTRIBUTED_LABEL, '', '', '', left.toFixed(DECIMALS), '', '']]
}

// A Markdown table, the read that costs the most CPU per minute first, then the round's unattributed rest.
function format(samples: ReadonlyArray<Sample>): string {
	const sorted = samples.toSorted((left, right) => cpu_per_minute(right) - cpu_per_minute(left))
	const rule = HEADER.map(() => '---')
	const rows = [...sorted.map((sample) => row_of(sample)), ...unattributed_rows(samples)]

	return [HEADER, rule, ...rows].map((cells) => line_of(cells)).join('\n')
}

const run_board_profile = { DEFAULT_RUNS, LIVE_PORTS, format, measure, measure_all, runs_of }

export { run_board_profile }
export type { Piece, ProfilePorts, Sample }
