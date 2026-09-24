import { run_headless } from '#scripts/run/run-headless'
import { backlog_ready, type ReadyPorts, type ReadyReading } from './backlog-ready'

// The arrival probe a `backlogrun` parent's `--wait` watcher runs while children are in flight
// (joshuafolkken/kit#2503). An issue opted in with `auto-ok` mid-run was picked up only when the parent
// next woke — a child's merge, or the progress interval — and in practice the ten-minute stall detector
// became the pick-up: #2493 waited 10.5 minutes, and the person got a ⏳ notification for it.
//
// **The watcher's exit is the only thing that wakes a live parent**, so the probe rides it: once a
// minute it reads the backlog the pick-up line reads (`backlog_ready.read_ready`, cheap first — a full
// pool answers without the network read), and an issue runnable now that was not runnable when the
// watcher started ends the wait. The exit prints the `ready #N` line as every exit does, and that line
// is what sends the parent to `backlog:offer`. The stall detector goes back to being the safety net.
//
// **"New" is measured against the watcher's own start**, so one issue wakes the parent once: the next
// `--wait` the parent starts takes the pool as it stands then — the woken issue included, dispatched or
// not — as its baseline. A reading that fails is not an arrival; the probe says nothing and the
// interval still wakes the parent. A baseline that cannot be read leaves that one wait inert rather than
// reading it as empty — an empty one would wake the parent for the whole pool — and the next `--wait`
// reads it again.
//
// **Every read is bounded.** The probe is awaited inside the watcher's tick loop, so a `gh` call that
// hangs would otherwise freeze the loop — its `--hours` bound, its liveness ping and the exit that is
// the parent's wake. A read past `READ_TIMEOUT_MS` is killed and counts as a failed read.

const PROBE_INTERVAL_MS = 60_000
const READ_TIMEOUT_MS = 30_000
const NO_FREE = 0
const NONE = 0

async function bounded_ready_issues(): Promise<ReadonlyArray<string>> {
	return await backlog_ready.answered_ready_issues(READ_TIMEOUT_MS)
}

const ARRIVAL_PORTS: ReadyPorts = {
	free_lane_count: backlog_ready.free_lane_count,
	ready_issues: bounded_ready_issues,
}

interface ArrivalProbe {
	has_arrived: (now_ms: number) => Promise<boolean>
}

// Runnable now, not runnable at the start, and a lane free to take it.
function arrivals(baseline: ReadonlySet<string>, reading: ReadyReading): ReadonlyArray<string> {
	if (reading.free_lanes <= NO_FREE) return []

	return reading.issues.filter((issue) => !baseline.has(issue))
}

// The baseline is the whole runnable pool, free lane or not: an issue that was waiting for a lane is not
// new when one frees, and the child's merge that freed it already wakes the parent.
async function read_baseline(ports: ReadyPorts): Promise<ReadonlySet<string> | undefined> {
	try {
		return new Set(await ports.ready_issues())
	} catch {
		return undefined
	}
}

async function read_reading(ports: ReadyPorts): Promise<ReadyReading | undefined> {
	try {
		return await backlog_ready.read_ready(ports)
	} catch {
		return undefined
	}
}

async function is_parent_safely(is_parent: () => Promise<boolean>): Promise<boolean> {
	try {
		return await is_parent()
	} catch {
		return false
	}
}

async function never_arrives(): Promise<boolean> {
	return false
}

const INERT: ArrivalProbe = { has_arrived: never_arrives }

// Only the next-probe instant changes between probes, and it is set before the read is awaited.
function probe_of(
	baseline: ReadonlySet<string>,
	first_ms: number,
	ports: ReadyPorts,
): ArrivalProbe {
	let next_ms = first_ms

	async function has_arrived(now_ms: number): Promise<boolean> {
		if (now_ms < next_ms) return false

		next_ms = now_ms + PROBE_INTERVAL_MS

		const reading = await read_reading(ports)

		return reading !== undefined && arrivals(baseline, reading).length > NONE
	}

	return { has_arrived }
}

// Inert outside a driving `backlogrun` parent — a `fullrun` watcher has no pool to pick from — and there
// it reads nothing at all.
async function start(
	now_ms: number,
	ports: ReadyPorts = ARRIVAL_PORTS,
	is_parent: () => Promise<boolean> = run_headless.is_backlog_parent,
): Promise<ArrivalProbe> {
	if (!(await is_parent_safely(is_parent))) return INERT

	const baseline = await read_baseline(ports)

	return baseline === undefined ? INERT : probe_of(baseline, now_ms + PROBE_INTERVAL_MS, ports)
}

const backlog_arrival = { INERT, PROBE_INTERVAL_MS, arrivals, start }

export type { ArrivalProbe }
export { backlog_arrival }
