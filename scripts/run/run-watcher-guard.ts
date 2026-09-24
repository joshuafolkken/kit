import { lane_registry } from '#scripts/lane/lane-registry'
import { run_progress_clock } from './run-progress-clock'

// A watcher that stopped while children are still in-flight leaves the parent blind to completions
// for up to the full heartbeat interval. This guard detects that state so a hook can refuse the
// calls that follow a missed restart (joshuafolkken/kit#2113).
//
// **Staleness threshold is `TICK_MULTIPLIER` watcher ticks.** The watcher pings its life record on
// every tick (every 30 s), so a gap wider than three ticks means the process has almost certainly
// stopped: either the bound expired or the session was cut without a restart. Three gives one missed
// tick of slack before the guard fires.
//
// **It watches no relay** (joshuafolkken/kit#2492). A session following the run's event stream after a
// cut used to be held to it here; that relay re-read the session's whole history per event, so the
// stream is now watched from a pane of its own (`run:event --watch`) and no session owes it.

const WATCHER_TICK_MS = 30_000
const TICK_MULTIPLIER = 3
const MS_PER_SECOND = 1000

const STALE_THRESHOLD_MS = WATCHER_TICK_MS * TICK_MULTIPLIER
const STALE_THRESHOLD_S = STALE_THRESHOLD_MS / MS_PER_SECOND

const STALE_NOTE =
	`Lane children are in-flight but the progress watcher has not pinged in the last ` +
	`${String(STALE_THRESHOLD_S)}s — run \`pnpm josh run:progress --wait\` in the background before proceeding`

type GuardResult = { kind: 'ok' } | { kind: 'stale'; note: string }

const OK_RESULT: GuardResult = { kind: 'ok' }

// The lanes a parent is still waiting on. A stranded lane has no child working in it, so it is not
// in-flight — the one definition both this guard and the headless stop rule read (`run-headless.ts`).
async function has_lanes_in_flight(): Promise<boolean> {
	const all_lanes = await lane_registry.list_lanes()

	return all_lanes.some((lane) => !lane.is_stranded)
}

// `life_target` is the path returned by `run_progress_read.stamp_target()` or
// `run_progress_clock.life_target_of(git_directory)`. Passed in rather than resolved here so the
// caller can use whichever resolution fits its sync/async context.
async function check(life_target: string): Promise<GuardResult> {
	if (!(await has_lanes_in_flight())) return OK_RESULT

	if (run_progress_clock.is_life_fresh(life_target, STALE_THRESHOLD_MS)) return OK_RESULT

	return { kind: 'stale', note: STALE_NOTE }
}

const run_watcher_guard = {
	STALE_NOTE,
	STALE_THRESHOLD_MS,
	check,
	has_lanes_in_flight,
}

export type { GuardResult }
export { run_watcher_guard }
