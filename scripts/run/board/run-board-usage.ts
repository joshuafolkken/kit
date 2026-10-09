// Each lane's CPU and memory on its `run:board` row: which lane is loading the machine the header's ⚡
// and 🧠 show. How the processes are read is `run-board-usage-read.ts`'s; this file turns two readings
// into each lane's figures.
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
	// Each process's parent, kept only where the counts fold in the children each reaped — empty on the
	// `ps` path, so nothing is deducted there.
	parents: ReadonlyMap<number, number>
	// The processes whose count was read with its reaped children folded in — one whose own read failed
	// keeps the larger of `ps`'s own time and its last reading, so nothing reaped is taken off it.
	folded: ReadonlySet<number>
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

// The nearest of a gone process's ancestors still running — the one whose reaped-children time it has
// landed in. Walked through the last sample's parents, at most once round them. Where a parent between
// them exited without waiting, launchd reaped the gone process instead and its counted time comes off an
// ancestor that never received it; which happened cannot be read once both are gone, and taking it off
// keeps the lane a lower bound where leaving it would count the usual waited-for child twice.
function live_ancestor(pid: number, before: UsageMark, after: UsageMark): number | undefined {
	let ancestor = before.parents.get(pid)

	for (let step = 0; step < before.parents.size; step += 1) {
		if (ancestor === undefined || after.processes.has(ancestor)) return ancestor
		ancestor = before.parents.get(ancestor)
	}

	return undefined
}

// What each running process's count already holds from earlier samples: a counted process that ended
// and was reaped brings all its time into its ancestor's, so what was counted for it is taken off there
// — only where that ancestor's count was read with its reaped children folded in.
function reaped_counted(before: UsageMark, after: UsageMark): Map<number, number> {
	const counted = new Map<number, number>()
	const gone = [...before.processes].filter(([pid]) => !after.processes.has(pid))

	for (const [pid, reading] of gone) {
		const ancestor = live_ancestor(pid, before, after)

		if (ancestor !== undefined && after.folded.has(ancestor)) {
			counted.set(ancestor, (counted.get(ancestor) ?? 0) + reading.cpu_ms)
		}
	}

	return counted
}

// A process that started since the last sample spent all its CPU time inside the interval; a count
// that went back — a reused process number — is read as none.
function cpu_spent(
	before: UsageMark,
	counted: ReadonlyMap<number, number>,
	{ pid, reading }: LaneProcess,
): number {
	const earlier = (before.processes.get(pid)?.cpu_ms ?? 0) + (counted.get(pid) ?? 0)

	return Math.max(0, reading.cpu_ms - earlier)
}

function spent_of(
	before: UsageMark | undefined,
	after: UsageMark,
): (process: LaneProcess) => number {
	if (before === undefined) return () => 0

	const counted = reaped_counted(before, after)

	return (lane_process) => cpu_spent(before, counted, lane_process)
}

function totals_of(before: UsageMark | undefined, after: UsageMark): Map<string, LaneTotal> {
	const totals = new Map<string, LaneTotal>()
	const spent = spent_of(before, after)

	for (const lane_process of lane_processes(after)) {
		const total = totals.get(lane_process.lane) ?? NO_TOTAL

		totals.set(lane_process.lane, {
			cpu_ms: total.cpu_ms + spent(lane_process),
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
