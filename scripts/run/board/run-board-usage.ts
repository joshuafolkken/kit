// Each process's CPU, memory and compressed memory on `run:board`: which lane, which part of the
// backlogrun, or which app outside it is loading the machine the header's 💪 and 🧠 show. How the
// processes are read is `run-board-usage-read.ts`'s, how they are grouped `run-board-process-groups.ts`'s;
// this file turns two readings into each process's figures and each lane's sum.
//
// CPU is a process's CPU time between two samples in cores, drawn as a percentage of the machine's
// cores — the header's 💪 unit, never Activity Monitor's one-core-is-100% — and memory what `top`'s
// MEM and CMPRS count, so the figures read the same in the lane rows and the processes section.

interface ProcessReading {
	cpu_ms: number
	memory_bytes: number
	compressed_bytes: number
}

interface UsageMark {
	at_ms: number
	processes: ReadonlyMap<number, ProcessReading>
	// Every listed process's lane, `undefined` for one under none — kept so each is looked up once.
	lanes: ReadonlyMap<number, string | undefined>
	// Each process's command, which names the app it belongs to.
	names: ReadonlyMap<number, string>
	// Each process's parent: the ancestry the processes section groups by, and the way to the ancestor
	// a gone process's reaped time landed in.
	parents: ReadonlyMap<number, number>
	// The processes whose count was read with its reaped children folded in — one whose own read failed
	// keeps the larger of `ps`'s own time and its last reading, so nothing reaped is taken off it. Empty
	// on the `ps` path, so nothing is deducted there.
	folded: ReadonlySet<number>
	cores: number
	total_bytes: number
}

// What one process or group uses. The cores are `undefined` on the first sample, which has nothing to
// take a difference from.
interface UsageFigure {
	cpu_cores: number | undefined
	memory_bytes: number
	compressed_bytes: number
}

// Each process's figure by its pid.
type ProcessFigures = ReadonlyMap<number, UsageFigure>

// Each lane's figure by its issue number.
type LaneUsages = ReadonlyMap<number, UsageFigure>

// What a gauge's full width stands for: the machine's cores and its physical memory.
interface UsageScale {
	cores: number
	total_bytes: number
}

const NO_FIGURE: UsageFigure = { cpu_cores: 0, memory_bytes: 0, compressed_bytes: 0 }

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
	pid: number,
	reading: ProcessReading,
): number {
	const earlier = (before.processes.get(pid)?.cpu_ms ?? 0) + (counted.get(pid) ?? 0)

	return Math.max(0, reading.cpu_ms - earlier)
}

// The cores a process used since the last sample, `undefined` with none to take a difference from.
function cores_of(
	before: UsageMark | undefined,
	after: UsageMark,
): ((pid: number, reading: ProcessReading) => number) | undefined {
	const elapsed = before === undefined ? 0 : after.at_ms - before.at_ms

	if (before === undefined || elapsed <= 0) return undefined

	const counted = reaped_counted(before, after)

	return (pid, reading) => cpu_spent(before, counted, pid, reading) / elapsed
}

function process_figures(
	before: UsageMark | undefined,
	after: UsageMark,
): Map<number, UsageFigure> {
	const cores = cores_of(before, after)
	const figures = [...after.processes].map(([pid, reading]) => {
		const { memory_bytes, compressed_bytes } = reading

		return [pid, { cpu_cores: cores?.(pid, reading), memory_bytes, compressed_bytes }] as const
	})

	return new Map(figures)
}

function cores_sum(left: number | undefined, right: number | undefined): number | undefined {
	return left === undefined || right === undefined ? undefined : left + right
}

// The figures' sum, its cores `undefined` where any one's are.
function sum_of(figures: Iterable<UsageFigure>): UsageFigure {
	let sum = NO_FIGURE

	for (const figure of figures) {
		sum = {
			cpu_cores: cores_sum(sum.cpu_cores, figure.cpu_cores),
			memory_bytes: sum.memory_bytes + figure.memory_bytes,
			compressed_bytes: sum.compressed_bytes + figure.compressed_bytes,
		}
	}

	return sum
}

// Each group's sum, the group of each process given by `group_of`; one in none is left out.
function grouped_sums<Key>(
	figures: ProcessFigures,
	group_of: (pid: number) => Key | undefined,
): Map<Key, UsageFigure> {
	const sums = new Map<Key, UsageFigure>()

	for (const [pid, figure] of figures) {
		const group = group_of(pid)

		if (group !== undefined) sums.set(group, sum_of([sums.get(group) ?? NO_FIGURE, figure]))
	}

	return sums
}

function lane_number(lane: string | undefined): number | undefined {
	return lane === undefined ? undefined : Number(lane)
}

// Each lane's processes' sum, by the lane each process's working directory sits under.
function usage_of(mark: UsageMark, figures: ProcessFigures): LaneUsages {
	return grouped_sums(figures, (pid) => lane_number(mark.lanes.get(pid)))
}

const run_board_usage = { grouped_sums, process_figures, sum_of, usage_of }

export { run_board_usage }
export type { LaneUsages, ProcessFigures, ProcessReading, UsageFigure, UsageMark, UsageScale }
