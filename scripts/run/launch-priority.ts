import { setPriority } from 'node:os'

// Lowering the launched session's priority preserves interactive responsiveness under saturation
// (#3947). Set niceness immediately after spawn, before the agent CLI forks descendants, so its
// gates, tests and builds inherit it. Efficiency-core confinement would throttle the lane beyond
// the intended yielding to interactive work.
const LANE_NICENESS = 10

type SetPriority = (pid: number, priority: number) => void

// **A priority that cannot be lowered starts the session as before.** A platform without the call, or
// a child that already runs at a lower priority than this, is not a reason to fail the launch.
function lower(pid: number | undefined, set_priority: SetPriority = setPriority): void {
	if (pid === undefined) return

	try {
		set_priority(pid, LANE_NICENESS)
	} catch {
		// the session keeps the priority it was started with
	}
}

const launch_priority = {
	LANE_NICENESS,
	lower,
}

export type { SetPriority }
export { launch_priority }
