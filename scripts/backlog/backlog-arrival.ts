import { epic_triage } from '#scripts/epic/epic-triage'
import type { JoshResult } from '#scripts/josh/josh-run'
import { lane_limit_override } from '#scripts/lane/lane-limit-override'
import { COMMAND_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { run_headless } from '#scripts/run/run-headless'
import { backlog_arrival_added } from './backlog-arrival-added'
import { backlog_next } from './backlog-next'
import { backlog_ready, type ReadyPorts, type ReadyReading } from './backlog-ready'
import { backlog_stalled } from './backlog-stalled'

// The arrival probe a `backlogrun` parent's `--wait` watcher runs while children are in flight.
// Without it, an issue opted in with `auto-ok` mid-run is picked up only when the parent
// next wakes — a child's merge, or the progress interval — so in practice the ten-minute stall detector
// becomes the pick-up, and the person gets a ⏳ notification for the wait.
//
// **The watcher's exit is the only thing that wakes a live parent**, so the probe rides it: once a
// minute it reads the backlog the pick-up line reads (`backlog_ready.read_ready`, cheap first — a full
// pool answers without the network read), and an issue runnable now that was not runnable when the
// watcher started ends the wait. The exit prints the `ready #N` line as every exit does, and that line
// is what sends the parent to `backlog:offer`. The stall detector stays the safety net.
//
// **"New" is measured against the watcher's own start**, so one issue wakes the parent once: the next
// `--wait` the parent starts takes the pool as it stands then — the woken issue included, dispatched or
// not — as its baseline. A reading that fails is not an arrival; the probe says nothing and reads again
// a minute later. A baseline that cannot be read is never read as empty — an empty one would wake the
// parent for the whole pool — but it is not given up on either: the scheduled report no longer ends the
// wait, so an inert probe would leave the parent without a wake until `--hours`. The
// probe reads the baseline again each minute until one answers.
//
// **Every read is bounded.** The probe is awaited inside the watcher's tick loop, so a `gh` call that
// hangs would otherwise freeze the loop — its `--hours` bound, its liveness ping and the exit that is
// the parent's wake. A read past `COMMAND_TIMEOUT_MS` is killed and counts as a failed read.
//
// **And strict.** `backlog:next` exits 0 on a `retry` (a transport failure) or an `error` verdict, which
// the lenient pick-up read takes as an empty pool — here that empty baseline is the whole-pool wake the
// paragraph above rules out, so either verdict, like a non-zero exit, is a read that did not answer.

const PROBE_INTERVAL_MS = 60_000
const SUCCESS_EXIT_CODE = 0
const NO_FREE = 0
const NONE = 0
const UNANSWERED: ReadonlySet<string> = new Set([
	backlog_next.VERDICT_TOKENS.error,
	backlog_next.VERDICT_TOKENS.retry,
])

// The runnable issues a `backlog:next` result names, or a throw where it did not answer. `undefined` is
// a `--only` run, whose pool is empty by definition.
function answered_issues(result: JoshResult | undefined): ReadonlyArray<string> {
	if (result === undefined) return []

	const lines = result.out.split('\n').map((line) => line.trim())

	if (result.code !== SUCCESS_EXIT_CODE || lines.some((line) => UNANSWERED.has(line))) {
		throw new Error('`backlog:next` did not answer')
	}

	// `triage` names no number, yet the parent has work — so it is read as one token, which a reading
	// sees as an arrival.
	if (backlog_stalled.needs_triage(result.out)) return [epic_triage.TRIAGE_VERDICT]

	return backlog_stalled.ready_tokens(result.out)
}

async function bounded_ready_issues(): Promise<ReadonlyArray<string>> {
	return answered_issues(await backlog_ready.read_backlog_next(COMMAND_TIMEOUT_MS))
}

// The backlog reads, plus whether `run:add` handed the run an issue since a given instant.
interface ArrivalPorts extends ReadyPorts {
	is_added_since: (since_ms: number) => Promise<boolean>
}

const ARRIVAL_PORTS: ArrivalPorts = {
	free_lane_count: backlog_ready.free_lane_count,
	ready_issues: bounded_ready_issues,
	is_added_since: backlog_arrival_added.is_added_since,
}

interface ArrivalProbe {
	has_arrived: (now_ms: number) => Promise<boolean>
}

// Runnable now, not runnable at the start, and a lane free to take it. **A raised lane limit makes the
// whole pool new**: the issues the baseline holds were waiting for a lane, and
// the raise — unlike a merge — wakes nothing else, so the room it made would sit idle until a merge.
function arrivals(
	baseline: ReadonlySet<string>,
	reading: ReadyReading,
	is_raised: boolean,
): ReadonlyArray<string> {
	if (reading.free_lanes <= NO_FREE) return []

	return is_raised ? reading.issues : reading.issues.filter((issue) => !baseline.has(issue))
}

// The baseline is the whole runnable pool, free lane or not: an issue that was waiting for a lane is not
// new when one frees, and the child's merge that freed it already wakes the parent.
//
// A baseline read during a `triage` answer names none of the issues it withheld, so every one of them
// would arrive once they were judged — the whole-pool wake. It is read as a baseline that did not answer.
async function read_baseline(ports: ReadyPorts): Promise<ReadonlySet<string> | undefined> {
	try {
		const issues = await ports.ready_issues()

		return issues.includes(epic_triage.TRIAGE_VERDICT) ? undefined : new Set(issues)
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

// A probe spent on the baseline reports no arrival, whether or not the baseline answered.
async function retry_baseline(
	answered: Array<ReadonlySet<string>>,
	ports: ReadyPorts,
): Promise<boolean> {
	const late = await read_baseline(ports)

	if (late !== undefined) answered.push(late)

	return false
}

// The next-probe instant is set before any read is awaited. A baseline that did not answer is read again
// at the next probe instead of the reading, and the first one that answers is the baseline from then on
// — never an arrival itself, since it is the pool as it stands.
function pool_probe_of(
	initial: ReadonlySet<string> | undefined,
	first_ms: number,
	ports: ReadyPorts,
	is_raised: () => boolean,
): ArrivalProbe {
	let next_ms = first_ms
	// At most one entry, held in a list so the baseline that answers after an await is added rather than
	// reassigned over the value read before it.
	const answered: Array<ReadonlySet<string>> = initial === undefined ? [] : [initial]

	async function has_arrived(now_ms: number): Promise<boolean> {
		if (now_ms < next_ms) return false

		next_ms = now_ms + PROBE_INTERVAL_MS

		const [baseline] = answered

		if (baseline === undefined) return await retry_baseline(answered, ports)

		const reading = await read_reading(ports)

		return reading !== undefined && arrivals(baseline, reading, is_raised()).length > NONE
	}

	return { has_arrived }
}

// An issue `run:add` handed the run since the watcher started wakes the parent at the next tick, ahead
// of the pool probe's minute.
function probe_of(
	initial: ReadonlySet<string> | undefined,
	started_ms: number,
	ports: ArrivalPorts,
	is_raised: () => boolean,
): ArrivalProbe {
	const pool = pool_probe_of(initial, started_ms + PROBE_INTERVAL_MS, ports, is_raised)

	async function has_arrived(now_ms: number): Promise<boolean> {
		if (await ports.is_added_since(started_ms)) return true

		return await pool.has_arrived(now_ms)
	}

	return { has_arrived }
}

// Inert outside a driving `backlogrun` parent — a `fullrun` watcher has no pool to pick from — and there
// it reads nothing at all. The raise watch starts with the probe, so only a raise after it wakes.
async function start(
	now_ms: number,
	ports: ArrivalPorts = ARRIVAL_PORTS,
	is_parent: () => Promise<boolean> = run_headless.is_backlog_parent,
	watch_raise: () => Promise<() => boolean> = lane_limit_override.watch_raise,
): Promise<ArrivalProbe> {
	if (!(await is_parent_safely(is_parent))) return INERT

	const is_raised = await watch_raise()

	return probe_of(await read_baseline(ports), now_ms, ports, is_raised)
}

const backlog_arrival = { PROBE_INTERVAL_MS, answered_issues, arrivals, start }

export type { ArrivalPorts, ArrivalProbe }
export { backlog_arrival }
