import {
	run_board_usage_rusage,
	type RusageReader,
} from '#scripts/run/board/run-board-usage-rusage'

// **The CPU a check's process tree spent, read off the gate's own reaped-children time**
// (joshuafolkken/kit#4362). Each check is a `pnpm josh <target>` child that waits for its tool before it
// exits, so once the gate has reaped it the whole tree's CPU sits in the gate's `proc_pid_rusage`
// child times (`run-board-usage-rusage.ts`, shared rather than read twice). The reader folds the
// gate's own time in, so `process.cpuUsage()` takes it back out, and each finished check takes the
// growth since the previous one finished.
//
// **A reading is an attribution, not an isolation**: any other child the gate reaped in between — a
// `ps` sample, a git call — lands on the next check that finishes, and two checks reaped in one tick
// split their CPU unevenly. Both are small beside a check's tools. Off macOS, or without `node:ffi`,
// there is no reader and every check records none.

const US_PER_MS = 1000

// The CPU milliseconds spent by the children reaped since the previous call, `undefined` where the
// gate's own usage cannot be read.
type CheckCpu = () => number | undefined

function own_cpu_ms(): number {
	const usage = process.cpuUsage()

	return (usage.user + usage.system) / US_PER_MS
}

function reaped_cpu_ms(read: RusageReader | undefined, pid: number): number | undefined {
	const reading = read?.(pid)

	return reading === undefined ? undefined : reading.cpu_ms - own_cpu_ms()
}

// One gate's reader, its baseline taken now — before any check is reaped.
function check_cpu_reader(
	read: RusageReader | undefined = run_board_usage_rusage.rusage_reader(
		process.platform,
		run_board_usage_rusage.load_builtin,
	),
	pid: number = process.pid,
): CheckCpu {
	const previous = { reaped_ms: reaped_cpu_ms(read, pid) }

	return function since_previous(): number | undefined {
		const reaped_ms = reaped_cpu_ms(read, pid)
		const before = previous.reaped_ms

		previous.reaped_ms = reaped_ms
		if (reaped_ms === undefined || before === undefined) return undefined

		return Math.max(0, reaped_ms - before)
	}
}

const check_cpu = { check_cpu_reader }

export type { CheckCpu }
export { check_cpu }
