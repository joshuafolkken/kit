import { lane_registry } from '#scripts/lane/lane-registry'
import { run_progress_clock } from '#scripts/run/progress/run-progress-clock'
import { run_headless } from './run-headless'

// A watcher that stopped while children are still in-flight leaves the run's event stream without a
// heartbeat and the parent without the wake an arrival would deliver. This guard detects that state so
// a hook can refuse the calls that follow a missed restart.
//
// **Staleness threshold is `TICK_MULTIPLIER` watcher ticks.** The watcher pings its life record on
// every tick (every 30 s), so a gap wider than three ticks means the process has almost certainly
// stopped: it exited on an arrival, its bound expired, or the session was cut without a restart. A
// report is not one of those — `--wait` streams its reports and keeps running — so a restart is owed
// only after an exit the parent was woken for. Three gives one missed tick of slack before the guard
// fires.
//
// **It watches no relay.** A relay would re-read the session's whole history per event, so the stream
// is watched from a pane of its own (`run:board`) and no session owes it.

const WATCHER_TICK_MS = 30_000
const TICK_MULTIPLIER = 3
const MS_PER_SECOND = 1000

const STALE_THRESHOLD_MS = WATCHER_TICK_MS * TICK_MULTIPLIER
const STALE_THRESHOLD_S = STALE_THRESHOLD_MS / MS_PER_SECOND

const STALE_NOTE =
	`Lane children are in-flight but the progress watcher has not pinged in the last ` +
	`${String(STALE_THRESHOLD_S)}s — run \`pnpm josh run:progress --wait\` in the background before proceeding. ` +
	'It reports to the run event stream on its own and exits only when newly runnable work arrives, so ' +
	'start it once and relay nothing'

type GuardResult = { kind: 'ok' } | { kind: 'stale'; note: string }

const OK_RESULT: GuardResult = { kind: 'ok' }

// **Only the run that opened the lanes owes them a watcher**. The lane listing is
// machine-wide, so without this a session with no run of its own — an investigation, a `fullrun`
// beside a batch — would be refused for another run's lanes. The session that drives the live
// `backlogrun` carry record is the one that dispatched them; every other session passes. A session
// `run:wake` woke owes none either: the supervisor's driver watches the lanes, and the woken session
// only acts on the branch it was handed and cuts.
async function owes_watcher(): Promise<boolean> {
	if (run_headless.is_headless() || !(await run_headless.is_backlog_parent())) return false

	return await lane_registry.has_lanes_in_flight()
}

// `life_target` is the path returned by `run_progress_read.stamp_target()` or
// `run_progress_clock.life_target_of(git_directory)`. Passed in rather than resolved here so the
// caller can use whichever resolution fits its sync/async context.
async function check(life_target: string): Promise<GuardResult> {
	if (!(await owes_watcher())) return OK_RESULT

	if (run_progress_clock.is_life_fresh(life_target, STALE_THRESHOLD_MS)) return OK_RESULT

	return { kind: 'stale', note: STALE_NOTE }
}

const run_watcher_guard = {
	STALE_NOTE,
	STALE_THRESHOLD_MS,
	check,
}

export type { GuardResult }
export { run_watcher_guard }
