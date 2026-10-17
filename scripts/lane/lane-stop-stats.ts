import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { lane_ledger, type LedgerEntry, type StopEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'

// How long a lane stood stopped: the ledger's `stop` entries of one period reduced to one row per stop
// reason — the wait's median, maximum and total, how many waits ended and how many never did — printed
// by `josh lane:stats` under the per-stage table, so the stop reason worth removing next is a number.
//
// **The wait is derived, not recorded**: from a stop to whichever comes first of the same issue's next
// ship stage (the lane resumed), its re-dispatch (a fresh lane took it over) and its park on the run's
// event stream (the run gave up on it) — the time the stop held the issue (joshuafolkken/kit#3997). A
// stop none of the three followed is counted under `not resumed` and kept out of the median, the
// maximum and the total, whose time has no end.

const COLUMNS = [
	'stop',
	'wait median (min)',
	'wait max (min)',
	'wait total (min)',
	'runs',
	'not resumed',
	'causes',
] as const
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
// `#<N> parked`, `#<N> parked (<reason>)` and `#<N> waiting on #<M>` name the parked issue first.
const PARKED_ISSUE = /#([1-9]\d*)\b/u

// A stop recorded before it carried a cause (joshuafolkken/kit#3998) is counted under this one.
const UNRECORDED_CAUSE = 'unrecorded'
const NO_CAUSES = '-'

interface StopWait {
	reason: string
	cause: string
	wait_ms: number | undefined
}

// One instant an issue's wait can end at. `issue` is absent on a stage whose writer held none.
interface IssueAt {
	issue: number | undefined
	at_ms: number
}

function is_stop(entry: LedgerEntry): entry is StopEntry {
	return entry.kind === lane_ledger.KIND.STOP
}

function parks_of(events: ReadonlyArray<RunEvent>): Array<IssueAt> {
	return events
		.filter((event) => event.kind === run_event_stream.EVENT_KIND.PARK)
		.map((event) => ({
			issue: Number(PARKED_ISSUE.exec(event.text)?.[1]),
			at_ms: Date.parse(event.at),
		}))
}

function ends_of(
	entries: ReadonlyArray<LedgerEntry>,
	parks: ReadonlyArray<IssueAt>,
): Array<IssueAt> {
	const resumes = entries
		.filter((entry) => is_stage(entry))
		.map((stage) => ({ issue: stage.issue, at_ms: lane_stage_stats.started_ms(stage) }))
	const dispatches = entries
		.filter((entry) => is_dispatch(entry))
		.map((entry) => ({ issue: entry.issue, at_ms: Date.parse(entry.at) }))

	return [...resumes, ...dispatches, ...parks]
}

// A stage's start counts from the stop's own instant, so a ship relaunched within the same
// millisecond still ends the wait; the stage that stopped started before it.
function wait_ms(stop: StopEntry, ends: ReadonlyArray<IssueAt>): number | undefined {
	const from_ms = Date.parse(stop.at)
	const later = ends
		.filter((end) => end.issue === stop.issue && end.at_ms >= from_ms)
		.map((end) => end.at_ms - from_ms)

	return later.length === 0 ? undefined : Math.min(...later)
}

function waits_of(
	entries: ReadonlyArray<LedgerEntry>,
	ends: ReadonlyArray<IssueAt>,
): Array<StopWait> {
	return entries.filter(is_stop).map((stop) => ({
		reason: stop.reason,
		cause: stop.cause ?? UNRECORDED_CAUSE,
		wait_ms: wait_ms(stop, ends),
	}))
}

function total(values: ReadonlyArray<number>): number | undefined {
	return values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0)
}

// `infra 2, check 1` — how many of one reason's stops each cause took, the most frequent first.
function causes_cell(waits: ReadonlyArray<StopWait>): string {
	const causes = [...new Set(waits.map((wait) => wait.cause))]
	const counted = causes.map((cause) => ({
		cause,
		count: waits.filter((wait) => wait.cause === cause).length,
	}))
	const ranked = counted.toSorted((left, right) => right.count - left.count)

	return ranked.length === 0
		? NO_CAUSES
		: ranked.map(({ cause, count }) => `${cause} ${String(count)}`).join(', ')
}

function reason_row(reason: string, waits: ReadonlyArray<StopWait>): string {
	const of_reason = waits.filter((wait) => wait.reason === reason)
	const ended = of_reason.map((wait) => wait.wait_ms).filter((value) => is_number(value))

	return lane_stats.to_row([
		reason,
		lane_stage_stats.cell(lane_stats.median(ended)),
		lane_stage_stats.cell(lane_stats.peak(ended)),
		lane_stage_stats.cell(total(ended)),
		String(ended.length),
		String(of_reason.length - ended.length),
		causes_cell(of_reason),
	])
}

// The period's table: `entries` is the whole ledger, filtered here to `window` — only the stops are; a
// wait may end after the period's last stop. `events` is the run's event stream, read for its parks.
function table(
	entries: ReadonlyArray<LedgerEntry>,
	window: StatsWindow,
	events: ReadonlyArray<RunEvent> = [],
): string {
	const ends = ends_of(entries, parks_of(events))
	const waits = waits_of(lane_stats.in_window(entries, window), ends)

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...REASONS.map((reason) => reason_row(reason, waits)),
	].join('\n')
}

const lane_stop_stats = { REASONS, table }

export { lane_stop_stats }
