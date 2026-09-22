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

const WATCHER_TICK_MS = 30_000
const TICK_MULTIPLIER = 3
const MS_PER_SECOND = 1000

const STALE_THRESHOLD_MS = WATCHER_TICK_MS * TICK_MULTIPLIER
const STALE_THRESHOLD_S = STALE_THRESHOLD_MS / MS_PER_SECOND

const STALE_NOTE =
	`Lane children are in-flight but the progress watcher has not pinged in the last ` +
	`${String(STALE_THRESHOLD_S)}s — run \`pnpm josh run:progress --wait\` in the background before proceeding`

type GuardResult = { kind: 'ok' } | { kind: 'stale'; note: string }

// `life_target` is the path returned by `run_progress_read.stamp_target()` or
// `run_progress_clock.life_target_of(git_directory)`. Passed in rather than resolved here so the
// caller can use whichever resolution fits its sync/async context.
async function check(life_target: string): Promise<GuardResult> {
	const all_lanes = await lane_registry.list_lanes()
	const lanes = all_lanes.filter((lane) => !lane.is_stranded)

	if (lanes.length === 0) return { kind: 'ok' }

	if (run_progress_clock.is_life_fresh(life_target, STALE_THRESHOLD_MS)) return { kind: 'ok' }

	return { kind: 'stale', note: STALE_NOTE }
}

const run_watcher_guard = {
	STALE_NOTE,
	STALE_THRESHOLD_MS,
	check,
}

export { run_watcher_guard }
