import { setPriority } from 'node:os'

// **A launched session runs below the interactive one, so a saturated machine still answers the
// user.** Every headless session and everything it starts — gates, tests, builds — used to share the
// interactive session's priority, and at a load of ~30 the lanes took the terminal's responsiveness
// with them (#3947). The niceness is set on the child right after `spawn` returns: a process inherits
// its parent's niceness at fork, and an agent CLI boots for far longer than this takes before it forks
// anything, so every descendant inherits it. Efficiency-core confinement (`taskpolicy -b`) is not
// used — it throttles a lane far beyond yielding to the user.
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
