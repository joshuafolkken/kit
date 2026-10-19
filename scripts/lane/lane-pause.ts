import { lane_reap, type TreeProbes } from './lane-reap'
import { lane_registry } from './lane-registry'

// Suspending a lane child in place, and letting it carry on from the same point.
//
// **Nothing but the processes is touched.** The work tree, the branch, the issue and the run's event
// stream stay as they are, so a paused lane is resumed rather than rebuilt — the one way to halt a lane
// that `lane:close` (which deletes it) and `lane:withdraw` (which closes its issue) are not.
//
// **The tree is `lane_reap`'s** — the same match, the same descendants, the caller's own ancestry
// spared — so a pause and a reap never disagree on which processes are the lane's.
//
// **A pause reads the tree again until no new process turns up.** A parent signalled after it had
// already forked leaves a child that was not in the first read running; each round stops what the
// last one did not see, up to `PAUSE_ROUNDS`.

const STOP_SIGNAL = 'SIGSTOP'
const CONTINUE_SIGNAL = 'SIGCONT'
const PAUSE_ROUNDS = 5

type LaneSignal = typeof STOP_SIGNAL | typeof CONTINUE_SIGNAL

interface PauseProbes extends TreeProbes {
	signal: (pid: number, name: LaneSignal) => boolean
}

function signal(pid: number, name: LaneSignal): boolean {
	try {
		process.kill(pid, name)

		return true
	} catch {
		return false
	}
}

const SYSTEM_PROBES: PauseProbes = { ...lane_reap.SYSTEM_PROBES, signal }

// Every pid read is `seen`, so a process the signal could not reach is not retried each round; only the
// ones the signal reached are `stopped`.
interface PauseProgress {
	seen: Set<number>
	stopped: Array<number>
}

function stop_unseen(issue: string, progress: PauseProgress, probes: PauseProbes): number {
	const unseen = lane_reap.lane_tree(issue, probes).filter((pid) => !progress.seen.has(pid))

	for (const pid of unseen) {
		progress.seen.add(pid)
		if (probes.signal(pid, STOP_SIGNAL)) progress.stopped.push(pid)
	}

	return unseen.length
}

/** SIGSTOP every process of the lane child for `issue`; returns the pids the signal reached. */
function pause_lane(issue: string, probes: PauseProbes = SYSTEM_PROBES): Array<number> {
	const progress: PauseProgress = { seen: new Set(), stopped: [] }

	for (let round = 0; round < PAUSE_ROUNDS; round += 1) {
		if (stop_unseen(issue, progress, probes) === 0) break
	}

	return progress.stopped
}

/** SIGCONT every process of the lane child for `issue`; returns the pids continued. */
function resume_lane(issue: string, probes: PauseProbes = SYSTEM_PROBES): Array<number> {
	return lane_reap.lane_tree(issue, probes).filter((pid) => probes.signal(pid, CONTINUE_SIGNAL))
}

async function open_issues(): Promise<Array<string>> {
	const lanes = await lane_registry.list_lanes()

	return lanes.map((lane) => lane.issue)
}

const lane_pause = { PAUSE_ROUNDS, open_issues, pause_lane, resume_lane }

export { lane_pause }
export type { LaneSignal, PauseProbes }
