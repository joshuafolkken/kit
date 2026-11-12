import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import {
	lane_ledger,
	type DispatchEntry,
	type LedgerEntry,
	type MergeEntry,
	type StageEntry,
} from './lane-ledger'
import { lane_stats, type StatsWindow } from './lane-stats'

// Where a lane's time goes: the ledger's `stage` and `dispatch` entries of one period reduced to one
// row per stage — median, maximum and how many runs — printed by `josh lane:stats` under the lane-limit
// row. The rows are in the order a lane passes them.
//
// **A stage nothing recorded prints `not measured`, never `0`.** A period that ran no second review
// round has no `round-2` duration, which is not a round that took no time.
//
// **`implement` is derived, not recorded**: from a lane's dispatch to the start of the first ship stage
// of the same issue that followed it. Nothing has to know, at the hand-off, when the child was
// dispatched, and a ship resumed after a fix cannot record the implementation twice.
//
// **`ci-wait` is `followup`'s own lap, inside the `followup` stage** — a row of its own so the wait for
// CI reads beside `review`, the round-one review it would overlap. `coderabbit-wait` and
// `coderabbit-rate-limit` follow it: how much of `followup`'s waiting CodeRabbit was still running or
// rate-limited, a row recorded only by a run that saw it.

const DECIMALS = 1
const NOT_MEASURED = 'not measured'
const IMPLEMENT = 'implement'
const DRIVER_NOTE = '(driver, outside lane net)'
const COLUMNS = ['stage', 'median (min)', 'max (min)', 'runs'] as const
const { STAGE } = run_ship_stage
const STAGES = [
	IMPLEMENT,
	STAGE.PREFLIGHT,
	lane_ledger.PRE_DETACH_STAGE,
	STAGE.REVIEW,
	STAGE.SYNC,
	STAGE.GATE,
	STAGE.COMMIT,
	STAGE.ROUND_TWO,
	STAGE.FOLLOWUP,
	lane_ledger.CI_WAIT_STAGE,
	lane_ledger.CODERABBIT_WAIT_STAGE,
	lane_ledger.CODERABBIT_RATE_LIMIT_STAGE,
	lane_ledger.CODERABBIT_RETRIGGER_STAGE,
	STAGE.REPORT,
] as const

interface Implement {
	issue: number
	ms: number
}

// A dispatch's implementation interval: it ends at the first ship stage that followed, else — still
// open — at the issue's next dispatch, `Infinity` for none.
interface ImplementSpan {
	issue: number
	from_ms: number
	to_ms: number
	is_open: boolean
}

interface Measured {
	implement: ReadonlyArray<number>
	stages: ReadonlyArray<StageEntry>
}

function is_stage(entry: LedgerEntry): entry is StageEntry {
	return entry.kind === lane_ledger.KIND.STAGE
}

function is_dispatch(entry: LedgerEntry): entry is DispatchEntry {
	return entry.kind === lane_ledger.KIND.DISPATCH
}

function is_merge(entry: LedgerEntry): entry is MergeEntry {
	return entry.kind === lane_ledger.KIND.MERGE
}

function is_number(value: number | undefined): value is number {
	return value !== undefined
}

function started_ms(stage: StageEntry): number {
	return Date.parse(stage.at) - stage.elapsed_ms
}

// Each issue's stage starts, indexed once so a dispatch reads only its own issue's stages.
function starts_by_issue(stages: ReadonlyArray<StageEntry>): ReadonlyMap<number, Array<number>> {
	const index = new Map<number, Array<number>>()

	for (const stage of stages) {
		if (stage.issue === undefined) continue
		const starts = index.get(stage.issue) ?? []

		starts.push(started_ms(stage))
		index.set(stage.issue, starts)
	}

	return index
}

// Each dispatch's next dispatch of the same issue, `Infinity` for none, in one backward pass: a child
// that died before its ship must not have its implementation stretched to the ship of the child that
// replaced it.
function next_dispatches_ms(sorted: ReadonlyArray<DispatchEntry>): Array<number> {
	const later = new Map<number, number>()

	return sorted
		.toReversed()
		.map((dispatch) => {
			const next_ms = later.get(dispatch.issue) ?? Infinity

			later.set(dispatch.issue, Date.parse(dispatch.at))

			return next_ms
		})
		.toReversed()
}

function implement_ms(
	from_ms: number,
	until_ms: number,
	starts: ReadonlyArray<number>,
): number | undefined {
	const inside = starts.filter((start) => start >= from_ms && start < until_ms)

	return inside.length === 0 ? undefined : Math.min(...inside) - from_ms
}

// Each dispatch's implementation interval in dispatch order.
function implement_spans(entries: ReadonlyArray<LedgerEntry>): Array<ImplementSpan> {
	const starts = starts_by_issue(entries.filter(is_stage))
	const sorted = entries
		.filter(is_dispatch)
		.toSorted((left, right) => Date.parse(left.at) - Date.parse(right.at))
	const next_ms = next_dispatches_ms(sorted)

	return sorted.map((dispatch, index) => {
		const from_ms = Date.parse(dispatch.at)
		const until_ms = next_ms[index] ?? Infinity
		const ms = implement_ms(from_ms, until_ms, starts.get(dispatch.issue) ?? [])

		return {
			issue: dispatch.issue,
			from_ms,
			to_ms: ms === undefined ? until_ms : from_ms + ms,
			is_open: ms === undefined,
		}
	})
}

// Each dispatch's implementation in dispatch order, a dispatch no ship stage followed left out.
function implements_of(entries: ReadonlyArray<LedgerEntry>): Array<Implement> {
	return implement_spans(entries)
		.filter((span) => !span.is_open)
		.map(({ issue, from_ms, to_ms }) => ({ issue, ms: to_ms - from_ms }))
}

// Each issue's implementation over every entry given — the latest dispatch's, so a reissued lane
// reads as the run that shipped (joshuafolkken/kit#6021).
function implement_by_issue(entries: ReadonlyArray<LedgerEntry>): ReadonlyMap<number, number> {
	return new Map(implements_of(entries).map(({ issue, ms }) => [issue, ms] as const))
}

function durations_of(stage: string, measured: Measured): ReadonlyArray<number> {
	if (stage === IMPLEMENT) return measured.implement

	return measured.stages.filter((entry) => entry.stage === stage).map((entry) => entry.elapsed_ms)
}

function cell(milliseconds: number | undefined): string {
	return milliseconds === undefined
		? NOT_MEASURED
		: (milliseconds / MS_PER_MINUTE).toFixed(DECIMALS)
}

// The row's name: the followup is the driver's wait, outside the lane's net time
// (joshuafolkken/kit#6541).
function label_of(stage: string): string {
	return stage === STAGE.FOLLOWUP ? `${stage} ${DRIVER_NOTE}` : stage
}

function stage_row(stage: string, measured: Measured): string {
	const durations = durations_of(stage, measured)

	return lane_stats.to_row([
		label_of(stage),
		cell(lane_stats.median(durations)),
		cell(lane_stats.peak(durations)),
		String(durations.length),
	])
}

function measured_of(entries: ReadonlyArray<LedgerEntry>): Measured {
	return {
		implement: implements_of(entries).map(({ ms }) => ms),
		stages: entries.filter(is_stage),
	}
}

// The period's table: `entries` is the whole ledger, filtered here to `window`.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const measured = measured_of(lane_stats.in_window(entries, window))

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...STAGES.map((stage) => stage_row(stage, measured)),
	].join('\n')
}

// Each stage's median over every entry given, a stage nothing recorded left out rather than read as
// `0` — how long a stage usually takes, which `run:board` measures a running child's phase against.
function medians(entries: ReadonlyArray<LedgerEntry>): ReadonlyMap<string, number> {
	const measured = measured_of(entries)

	return new Map(
		STAGES.flatMap((stage) => {
			const median = lane_stats.median(durations_of(stage, measured))

			return median === undefined ? [] : [[stage, median] as const]
		}),
	)
}

const lane_stage_stats = {
	IMPLEMENT,
	NOT_MEASURED,
	STAGES,
	cell,
	implement_by_issue,
	implement_spans,
	is_dispatch,
	is_merge,
	is_number,
	is_stage,
	medians,
	started_ms,
	table,
}

export { lane_stage_stats }
