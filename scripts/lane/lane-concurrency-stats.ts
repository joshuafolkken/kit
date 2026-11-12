import { MS_PER_MINUTE, MS_PER_SECOND } from '#scripts/lib/timeouts'
import { lane_ledger, type LedgerEntry, type LoadEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import type { ToolCall } from './lane-transcript-calls'
import { lane_transcript_stats } from './lane-transcript-stats'

// The solo `lint:related` / `test:related` calls split by how many lanes ran beside them
// (joshuafolkken/kit#7025): the evidence a `JOSH_LANE_LIMIT` or verification-parallelism change is
// filed from. A call's lane count is the latest load sample's `lanes` at or before it started; a call
// with no sample within `SAMPLE_MAX_AGE_MS` before it is left out, since an old sample says nothing of
// the lanes it ran beside.

const TIMED_COMMANDS: ReadonlyArray<string> = ['lint:related', 'test:related']
const SAMPLE_MAX_AGE_MINUTES = 5
const SAMPLE_MAX_AGE_MS = SAMPLE_MAX_AGE_MINUTES * MS_PER_MINUTE
const DECIMALS = 1
const COLUMNS = [
	'concurrent lanes',
	...TIMED_COMMANDS.flatMap((name) => [`${name} runs`, `${name} median (s)`]),
]

type CountedSample = LoadEntry & { lanes: number }

interface LaneSample {
	at_ms: number
	lanes: number
}

interface TimedRun {
	name: string
	lanes: number
	ms: number
}

function is_counted(entry: LedgerEntry): entry is CountedSample {
	return entry.kind === lane_ledger.KIND.LOAD && entry.lanes !== undefined
}

function samples_of(entries: ReadonlyArray<LedgerEntry>): Array<LaneSample> {
	return entries
		.filter(is_counted)
		.map((entry) => ({ at_ms: Date.parse(entry.at), lanes: entry.lanes }))
		.toSorted((left, right) => left.at_ms - right.at_ms)
}

function lanes_at(samples: ReadonlyArray<LaneSample>, started_ms: number): number | undefined {
	const sample = samples.findLast((candidate) => candidate.at_ms <= started_ms)

	return sample !== undefined && started_ms - sample.at_ms <= SAMPLE_MAX_AGE_MS
		? sample.lanes
		: undefined
}

function timed_run(name: string, call: ToolCall, lanes: number | undefined): Array<TimedRun> {
	if (lanes === undefined || call.duration_ms === undefined) return []

	return [{ name, lanes, ms: call.duration_ms }]
}

function timed_runs(
	calls: ReadonlyArray<ToolCall>,
	samples: ReadonlyArray<LaneSample>,
): Array<TimedRun> {
	return TIMED_COMMANDS.flatMap((name) =>
		lane_transcript_stats
			.solo_calls(calls, name)
			.flatMap((call) => timed_run(name, call, lanes_at(samples, call.started_ms))),
	)
}

function seconds_cell(values: ReadonlyArray<number>): string {
	const median = lane_stats.median(values)

	return median === undefined
		? lane_stage_stats.NOT_MEASURED
		: (median / MS_PER_SECOND).toFixed(DECIMALS)
}

function lane_row(lanes: number, runs: ReadonlyArray<TimedRun>): string {
	const at_count = runs.filter((run) => run.lanes === lanes)
	const cells = TIMED_COMMANDS.flatMap((name) => {
		const durations = at_count.filter((run) => run.name === name).map((run) => run.ms)

		return [String(durations.length), seconds_cell(durations)]
	})

	return lane_stats.to_row([String(lanes), ...cells])
}

// The period's table: `entries` is the whole ledger, so a call early in `window` still finds the
// sample taken just before it; `calls` is every lane session's calls, filtered here to `window`.
function table(
	entries: ReadonlyArray<LedgerEntry>,
	calls: ReadonlyArray<ToolCall>,
	window: StatsWindow,
): string {
	const runs = timed_runs(lane_transcript_stats.in_period(calls, window), samples_of(entries))
	const counts = [...new Set(runs.map((run) => run.lanes))].toSorted((left, right) => left - right)

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...counts.map((lanes) => lane_row(lanes, runs)),
	].join('\n')
}

const lane_concurrency_stats = { table }

export { lane_concurrency_stats }
