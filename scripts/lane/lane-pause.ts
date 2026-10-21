import { lane_reap, type LaneProcesses, type ReapProbes } from './lane-reap'
import { lane_registry } from './lane-registry'
import { lane_residents } from './lane-residents'

// Suspending a lane child in place, and letting it carry on from the same point.
//
// **Nothing but the processes is touched here.** The work tree, the branch and the issue stay as they
// are, so a paused lane is resumed rather than rebuilt — the one way to halt a lane that `lane:close`
// (which deletes it) and `lane:withdraw` (which takes its issue out of the run) are not. The command
// (`lane-pause-cli.ts`) records the change in the lane's state and on the run's event stream.
//
// **The tree is `lane_reap`'s** — the same match, the same descendants, the caller's own ancestry
// spared — so a pause and a reap never disagree on which processes are the lane's.
//
// **A pause reads the tree again until no new process turns up.** A parent signalled after it had
// already forked leaves a child that was not in the first read running; each round stops what the
// last one did not see, up to `PAUSE_ROUNDS`.
//
// **A process detached from the tree is stopped and continued with it** (joshuafolkken/kit#4300): the
// edit hook's `eslint_d`, a detached `ship`, found by its working directory or mark as `lane:close`
// finds it (`lane-residents.ts`), so a resume reaches every process the pause stopped.

const STOP_SIGNAL = 'SIGSTOP'
const CONTINUE_SIGNAL = 'SIGCONT'
const PAUSE_ROUNDS = 5

type LaneSignal = typeof STOP_SIGNAL | typeof CONTINUE_SIGNAL

interface PauseProbes extends ReapProbes {
	signal: (pid: number, name: LaneSignal) => boolean
	// What runs from the lane outside the tree (`lane-residents.ts`).
	residents: (lane: LaneProcesses) => ReadonlyArray<number>
}

// What a pause or a resume reached: the lane's processes signalled.
interface LaneSignalled {
	signalled: Array<number>
}

function signal(pid: number, name: LaneSignal): boolean {
	try {
		process.kill(pid, name)

		return true
	} catch {
		return false
	}
}

const SYSTEM_PROBES: PauseProbes = {
	...lane_reap.SYSTEM_PROBES,
	signal,
	residents: (lane) => lane_residents.residents(lane) ?? [],
}

// The lane child's tree and what runs from the lane outside it, each once.
function lane_processes(lane: LaneProcesses, probes: PauseProbes): Array<number> {
	return [...new Set([...lane_reap.lane_tree(lane.issue, probes), ...probes.residents(lane)])]
}

// Every pid read is `seen`, so a process the signal could not reach is not retried each round; only the
// ones the signal reached are `stopped`.
interface PauseProgress {
	seen: Set<number>
	stopped: Array<number>
}

function stop_unseen(lane: LaneProcesses, progress: PauseProgress, probes: PauseProbes): number {
	const unseen = lane_processes(lane, probes).filter((pid) => !progress.seen.has(pid))

	for (const pid of unseen) {
		progress.seen.add(pid)
		if (probes.signal(pid, STOP_SIGNAL)) progress.stopped.push(pid)
	}

	return unseen.length
}

/** SIGSTOP every process of the lane; returns the pids stopped. */
function pause_lane(lane: LaneProcesses, probes: PauseProbes = SYSTEM_PROBES): LaneSignalled {
	const progress: PauseProgress = { seen: new Set(), stopped: [] }

	for (let round = 0; round < PAUSE_ROUNDS; round += 1) {
		if (stop_unseen(lane, progress, probes) === 0) break
	}

	return { signalled: progress.stopped }
}

/** SIGCONT every process of the lane; returns the pids continued. */
function resume_lane(lane: LaneProcesses, probes: PauseProbes = SYSTEM_PROBES): LaneSignalled {
	const processes = lane_processes(lane, probes)

	return { signalled: processes.filter((pid) => probes.signal(pid, CONTINUE_SIGNAL)) }
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
