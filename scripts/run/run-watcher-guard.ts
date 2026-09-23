import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_registry } from '#scripts/lane/lane-registry'
import { run_carry, type CarryRead } from './run-carry'
import { run_event_follow } from './run-event-follow'
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
// **The relay is the second thing it watches** (joshuafolkken/kit#2437). Once a `backlogrun` has cut,
// the attached session no longer runs the watcher — a headless successor does — so what keeps a person
// seeing progress is that session following the run's event stream (`run:event --follow`). Each pass
// pings a life record of its own, and a relay that stopped being restarted goes stale exactly as the
// watcher does. One pass may be quiet for a whole follow interval, so the relay's threshold is that
// interval plus the same three-tick slack.

const WATCHER_TICK_MS = 30_000
const TICK_MULTIPLIER = 3
const MS_PER_SECOND = 1000
const NO_CUTS = 0
const RELAY_LIFE_PREFIX = 'josh-run-relay-life-'

const STALE_THRESHOLD_MS = WATCHER_TICK_MS * TICK_MULTIPLIER
const STALE_THRESHOLD_S = STALE_THRESHOLD_MS / MS_PER_SECOND
const RELAY_STALE_THRESHOLD_MS = run_event_follow.FOLLOW_INTERVAL_MS + STALE_THRESHOLD_MS

const STALE_NOTE =
	`Lane children are in-flight but the progress watcher has not pinged in the last ` +
	`${String(STALE_THRESHOLD_S)}s — run \`pnpm josh run:progress --wait\` in the background before proceeding`

const RELAY_STALE_NOTE =
	'This `backlogrun` has cut, and nothing is relaying its event stream to this session — run ' +
	'`pnpm josh run:event --follow <position>` in the background, relay what it prints, and restart it ' +
	'from the `next_position` it reports each time it exits (`backlogrun-progress.md` → "The report ' +
	'surface belongs to the run")'

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

// A run that has crossed a cut. `expired` still counts: a spent budget may yet have lanes finishing,
// and a person watching them is exactly who the relay is for.
function has_cut(read: CarryRead): boolean {
	if (read.kind !== 'carried' && read.kind !== 'expired') return false

	return read.carry.cuts > NO_CUTS
}

function check_relay(relay_target: string, read: CarryRead): GuardResult {
	if (!has_cut(read)) return OK_RESULT

	if (run_progress_clock.is_life_fresh(relay_target, RELAY_STALE_THRESHOLD_MS)) return OK_RESULT

	return { kind: 'stale', note: RELAY_STALE_NOTE }
}

// Keyed on the common git directory, as the carry record and the event stream are, because the relay
// follows the run and not a work tree.
function relay_target_of(repository: string): string {
	return stamp_file.stamp_path(RELAY_LIFE_PREFIX, repository)
}

async function relay_inputs(): Promise<{ target: string; read: CarryRead } | undefined> {
	const repository = await run_carry.repository_directory()

	if (repository === undefined) return undefined

	return {
		target: relay_target_of(repository),
		read: run_carry.read_carry(run_carry.carry_path(repository)),
	}
}

// The relay's verdict for this repository, or `ok` where no repository can be read.
async function check_relay_here(): Promise<GuardResult> {
	const inputs = await relay_inputs()

	return inputs === undefined ? OK_RESULT : check_relay(inputs.target, inputs.read)
}

// Best-effort by the reporting contract: a relay that cannot write its life record still relays.
async function ping_relay(): Promise<void> {
	try {
		const repository = await run_carry.repository_directory()

		if (repository !== undefined) run_progress_clock.ping_life(relay_target_of(repository))
	} catch {
		// A lost ping at worst costs one refusal from the relay guard, never the relay itself.
	}
}

const run_watcher_guard = {
	RELAY_STALE_NOTE,
	RELAY_STALE_THRESHOLD_MS,
	STALE_NOTE,
	STALE_THRESHOLD_MS,
	check,
	check_relay,
	check_relay_here,
	has_lanes_in_flight,
	ping_relay,
	relay_target_of,
}

export type { GuardResult }
export { run_watcher_guard }
