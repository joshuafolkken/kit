import { lane_reap, type LaneProcesses, type ReapProbes } from './lane-reap'
import { lane_registry } from './lane-registry'

// Suspending a lane child in place, and letting it carry on from the same point.
//
// **Nothing but the processes is touched here.** The work tree, the branch and the issue stay as they
// are, so a paused lane is resumed rather than rebuilt — the one way to halt a lane that `lane:close`
// (which deletes it) and `lane:withdraw` (which closes its issue) are not. The command
// (`lane-pause-cli.ts`) records the change in the lane's state and on the run's event stream.
//
// **The tree is `lane_reap`'s** — the same match, the same descendants, the caller's own ancestry
// spared — so a pause and a reap never disagree on which processes are the lane's.
//
// **A pause reads the tree again until no new process turns up.** A parent signalled after it had
// already forked leaves a child that was not in the first read running; each round stops what the
// last one did not see, up to `PAUSE_ROUNDS`.
//
// **The lane's `eslint_d` is ended, not stopped** (joshuafolkken/kit#4265). It is detached from the
// tree, so a resume would not reach it, and a lint after the resume would wait on a stopped daemon;
// ended, the next lint starts it again.

const STOP_SIGNAL = 'SIGSTOP'
const CONTINUE_SIGNAL = 'SIGCONT'
const PAUSE_ROUNDS = 5

type LaneSignal = typeof STOP_SIGNAL | typeof CONTINUE_SIGNAL

interface PauseProbes extends ReapProbes {
	signal: (pid: number, name: LaneSignal) => boolean
}

// What a pause or a resume reached: the child's processes signalled, and the daemons ended.
interface LaneSignalled {
	signalled: Array<number>
	ended: Array<number>
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

/** End the lane's `eslint_d`, then SIGSTOP every process of its child; returns what each reached. */
function pause_lane(lane: LaneProcesses, probes: PauseProbes = SYSTEM_PROBES): LaneSignalled {
	const ended = lane_reap.end_daemons(lane.directory, probes)
	const progress: PauseProgress = { seen: new Set(), stopped: [] }

	for (let round = 0; round < PAUSE_ROUNDS; round += 1) {
		if (stop_unseen(lane.issue, progress, probes) === 0) break
	}

	return { signalled: progress.stopped, ended }
}

/** SIGCONT every process of the lane child; returns the pids continued. */
function resume_lane(lane: LaneProcesses, probes: PauseProbes = SYSTEM_PROBES): LaneSignalled {
	const tree = lane_reap.lane_tree(lane.issue, probes)

	return { signalled: tree.filter((pid) => probes.signal(pid, CONTINUE_SIGNAL)), ended: [] }
}

// Only what a pause reads: a lane is matched by its issue and its directory, nothing else.
function processes_of(lane: LaneProcesses): LaneProcesses {
	return { issue: lane.issue, directory: lane.directory }
}

async function open_lanes(): Promise<Array<LaneProcesses>> {
	const lanes = await lane_registry.list_lanes()

	return lanes.map((lane) => processes_of(lane))
}

const lane_pause = { PAUSE_ROUNDS, open_lanes, pause_lane, resume_lane }

export { lane_pause }
export type { LaneSignal, LaneSignalled, PauseProbes }
