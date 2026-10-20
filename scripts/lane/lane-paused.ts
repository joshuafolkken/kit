import { lane_reap, type TreeProbes } from './lane-reap'

// Whether a lane is paused — every process of it suspended, by `lane:pause` or a hand-sent
// `kill -STOP` — the one reading `run:board` draws `paused` on and the lane limit leaves uncounted
// (joshuafolkken/kit#4198, #4201).
//
// **A lane is paused when it has a live process and every one is stopped (`T`).** A zombie (`Z`) has
// already exited and stops nothing, so it is left out either way; one process still running keeps the
// lane running.
//
// **The tree is `lane_reap`'s** — the matched child and every descendant, as `lane:pause` stops them —
// so a hand `kill -STOP` of the child alone, its `gate` subprocesses still running, is not paused.
// **A lane whose states could not be read is not paused**, so the limit errs toward fewer free lanes.
// The probes are `lane_process_table`'s one asynchronous snapshot, never a spawn per process (#4241).

const STOPPED_STATE = 'T'
const ZOMBIE_STATE = 'Z'

interface PausedProbes extends TreeProbes {
	// Each pid's `ps` `stat`, the empty list for a read that failed.
	states_of: (pids: ReadonlyArray<number>) => Array<string>
}

function is_live(stat: string): boolean {
	return !stat.startsWith(ZOMBIE_STATE)
}

/** Whether `stats` — one lane's processes' `ps` states — hold a live process, every one stopped. */
function is_paused(stats: ReadonlyArray<string>): boolean {
	const live = stats.filter((stat) => is_live(stat))

	return live.length > 0 && live.every((stat) => stat.startsWith(STOPPED_STATE))
}

/** Whether the lane child for `issue` is paused; a lane with no process or no readable state is not. */
function is_lane_paused(issue: string, probes: PausedProbes): boolean {
	const pids = lane_reap.lane_tree(issue, probes)

	if (pids.length === 0) return false

	return is_paused(probes.states_of(pids))
}

const lane_paused = { is_lane_paused, is_paused }

export { lane_paused }
export type { PausedProbes }
