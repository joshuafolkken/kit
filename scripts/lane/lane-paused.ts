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
// **A lane whose states could not be read is not paused**, so the limit errs toward fewer free lanes;
// the tree's states are read in one `ps`.

const STOPPED_STATE = 'T'
const ZOMBIE_STATE = 'Z'
const STAT_FORMAT = ['-o', 'stat=', '-p']

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

function states_of(pids: ReadonlyArray<number>): Array<string> {
	const printed = lane_reap.run_probe(lane_reap.PS_COMMAND, [...STAT_FORMAT, pids.join(',')])

	return printed
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '')
}

const SYSTEM_PROBES: PausedProbes = { ...lane_reap.SYSTEM_PROBES, states_of }

/** Whether the lane child for `issue` is paused; a lane with no process or no readable state is not. */
function is_lane_paused(issue: string, probes: PausedProbes = SYSTEM_PROBES): boolean {
	const pids = lane_reap.lane_tree(issue, probes)

	if (pids.length === 0) return false

	return is_paused(probes.states_of(pids))
}

const lane_paused = { is_lane_paused, is_paused, states_of }

export { lane_paused }
export type { PausedProbes }
