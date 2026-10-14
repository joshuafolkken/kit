import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { lane_ledger, type LedgerEntry, type StopEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'

// How long a lane stood stopped: the ledger's `stop` entries of one period reduced to one row per stop
// reason — median, maximum, how many stops were resumed and how many never were — printed by
// `josh lane:stats` under the per-stage table, so the stop reason worth removing next is a number.
//
// **The wait is derived, not recorded**: from a stop to the start of the same issue's next ship stage,
// the way `implement` is. A stop that no ship stage followed — the lane parked, or left stopped — is
// counted under `not resumed` and kept out of the median and the maximum, whose time has no end.
//
// **A re-dispatch of the issue ends the search**: the new child's ship is a fresh lane's work, not the
// resumption of a stop that may be days old.

const COLUMNS = ['stop', 'median (min)', 'max (min)', 'runs', 'not resumed'] as const
const { STAGE } = run_ship_stage
const { is_dispatch, is_number, is_stage } = lane_stage_stats
const REASONS = [
	STAGE.PREFLIGHT,
	STAGE.REVIEW,
	STAGE.SYNC,
	run_ship_stage.CONFLICT,
	STAGE.GATE,
	STAGE.COMMIT,
	STAGE.ROUND_TWO,
	STAGE.FOLLOWUP,
	STAGE.REPORT,
] as const

interface StopWait {
	reason: string
	wait_ms: number | undefined
}

function is_stop(entry: LedgerEntry): entry is StopEntry {
	return entry.kind === lane_ledger.KIND.STOP
}

function redispatch_ms(stop: StopEntry, entries: ReadonlyArray<LedgerEntry>): number {
	const from_ms = Date.parse(stop.at)
	const later = entries
		.filter((entry) => is_dispatch(entry))
		.filter((entry) => entry.issue === stop.issue)
		.map((entry) => Date.parse(entry.at))
		.filter((at) => at > from_ms)

	return later.length === 0 ? Infinity : Math.min(...later)
}

function wait_ms(stop: StopEntry, entries: ReadonlyArray<LedgerEntry>): number | undefined {
	const from_ms = Date.parse(stop.at)
	const until_ms = redispatch_ms(stop, entries)
	const starts = entries
		.filter((entry) => is_stage(entry))
		.filter((stage) => stage.issue === stop.issue)
		.map((stage) => lane_stage_stats.started_ms(stage))
		.filter((start) => start >= from_ms && start < until_ms)

	return starts.length === 0 ? undefined : Math.min(...starts) - from_ms
}

function waits_of(entries: ReadonlyArray<LedgerEntry>): Array<StopWait> {
	return entries
		.filter(is_stop)
		.map((stop) => ({ reason: stop.reason, wait_ms: wait_ms(stop, entries) }))
}

function reason_row(reason: string, waits: ReadonlyArray<StopWait>): string {
	const of_reason = waits.filter((wait) => wait.reason === reason)
	const resumed = of_reason.map((wait) => wait.wait_ms).filter((value) => is_number(value))

	return lane_stats.to_row([
		reason,
		lane_stage_stats.cell(lane_stats.median(resumed)),
		lane_stage_stats.cell(lane_stats.peak(resumed)),
		String(resumed.length),
		String(of_reason.length - resumed.length),
	])
}

// The period's table: `entries` is the whole ledger, filtered here to `window`.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const waits = waits_of(lane_stats.in_window(entries, window))

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...REASONS.map((reason) => reason_row(reason, waits)),
	].join('\n')
}

const lane_stop_stats = { REASONS, table }

export { lane_stop_stats }
