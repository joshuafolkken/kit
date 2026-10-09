// Each lane's CPU and memory on its `run:board` row (joshuafolkken/kit#3489): which lane is loading the
// machine the header's ⚡ and 🧠 show. On 2026-10-09 two of seven lanes held most of the CPU, and the
// board could not say which. How the processes are read is `run-board-usage-read.ts`'s; this file turns
// two readings into each lane's figures.
//
// A lane's CPU is its processes' CPU time between two samples as a share of the whole machine — the
// header's ⚡ scale, so the two read side by side, never Activity Monitor's one-core-is-100% — and its
// memory the sum of their resident sets. Shared pages are counted once per process, so the figure is
// larger than what the kernel holds; it compares lanes, which is all the column is for.

const PERCENT = 100

interface ProcessReading {
	cpu_ms: number
	rss_bytes: number
}

interface UsageMark {
	at_ms: number
	processes: ReadonlyMap<number, ProcessReading>
	// Every listed process's lane, `undefined` for one under none — kept so each is looked up once.
	lanes: ReadonlyMap<number, string | undefined>
	cores: number
	total_bytes: number
}

// The CPU share is `undefined` on the first sample, which has nothing to take a difference from.
interface LaneUsage {
	cpu_percent: number | undefined
	memory_bytes: number
	memory_percent: number
}

// Each lane's usage by its issue number.
type LaneUsages = ReadonlyMap<number, LaneUsage>

interface LaneProcess {
	lane: string
	pid: number
	reading: ProcessReading
}

interface LaneTotal {
	cpu_ms: number
	rss_bytes: number
}

const NO_TOTAL: LaneTotal = { cpu_ms: 0, rss_bytes: 0 }

function lane_processes(mark: UsageMark): Array<LaneProcess> {
	const processes = [...mark.processes].map(([pid, reading]) => {
		const lane = mark.lanes.get(pid)

		return lane === undefined ? undefined : { lane, pid, reading }
	})

	return processes.filter((lane_process) => lane_process !== undefined)
}

// A process that started since the last sample spent all its CPU time inside the interval; a count
// that went back — a reused process number — is read as none.
function cpu_spent(before: UsageMark | undefined, { pid, reading }: LaneProcess): number {
	if (before === undefined) return 0

	return Math.max(0, reading.cpu_ms - (before.processes.get(pid)?.cpu_ms ?? 0))
}

function totals_of(before: UsageMark | undefined, after: UsageMark): Map<string, LaneTotal> {
	const totals = new Map<string, LaneTotal>()

	for (const lane_process of lane_processes(after)) {
		const total = totals.get(lane_process.lane) ?? NO_TOTAL

		totals.set(lane_process.lane, {
			cpu_ms: total.cpu_ms + cpu_spent(before, lane_process),
			rss_bytes: total.rss_bytes + lane_process.reading.rss_bytes,
		})
	}

	return totals
}

function cpu_percent(
	before: UsageMark | undefined,
	after: UsageMark,
	cpu_ms: number,
): number | undefined {
	const elapsed = before === undefined ? 0 : after.at_ms - before.at_ms

	return elapsed <= 0 ? undefined : (cpu_ms / (elapsed * after.cores)) * PERCENT
}

function lane_usage(before: UsageMark | undefined, after: UsageMark, total: LaneTotal): LaneUsage {
	return {
		cpu_percent: cpu_percent(before, after, total.cpu_ms),
		memory_bytes: total.rss_bytes,
		memory_percent: (total.rss_bytes / after.total_bytes) * PERCENT,
	}
}

function usage_of(before: UsageMark | undefined, after: UsageMark): LaneUsages {
	const totals = [...totals_of(before, after)]

	return new Map(totals.map(([lane, total]) => [Number(lane), lane_usage(before, after, total)]))
}

const run_board_usage = { usage_of }

export { run_board_usage }
export type { LaneUsage, LaneUsages, ProcessReading, UsageMark }
