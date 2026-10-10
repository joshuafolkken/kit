import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { lane_ledger, type DispatchEntry, type LedgerEntry, type StageEntry } from './lane-ledger'
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
// CI reads beside `review`, the round-one review it would overlap.

const MS_PER_MINUTE = 60_000
const DECIMALS = 1
const NOT_MEASURED = 'not measured'
const IMPLEMENT = 'implement'
const COLUMNS = ['stage', 'median (min)', 'max (min)', 'runs'] as const
const { STAGE } = run_ship_stage
const STAGES = [
	IMPLEMENT,
	STAGE.PREFLIGHT,
	STAGE.REVIEW,
	STAGE.SYNC,
	STAGE.GATE,
	STAGE.COMMIT,
	STAGE.ROUND_TWO,
	STAGE.FOLLOWUP,
	lane_ledger.CI_WAIT_STAGE,
	STAGE.REPORT,
] as const

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

function is_number(value: number | undefined): value is number {
	return value !== undefined
}

function started_ms(stage: StageEntry): number {
	return Date.parse(stage.at) - stage.elapsed_ms
}

// When the same issue was dispatched again, or never: a child that died before its ship must not have
// its implementation stretched to the ship of the child that replaced it.
function next_dispatch_ms(sorted: ReadonlyArray<DispatchEntry>, index: number): number {
	const next = sorted.slice(index + 1).find((entry) => entry.issue === sorted[index]?.issue)

	return next === undefined ? Infinity : Date.parse(next.at)
}

function implement_ms(
	dispatch: DispatchEntry,
	until_ms: number,
	stages: ReadonlyArray<StageEntry>,
): number | undefined {
	const from_ms = Date.parse(dispatch.at)
	const starts = stages
		.filter((stage) => stage.issue === dispatch.issue)
		.map((stage) => started_ms(stage))
		.filter((start) => start >= from_ms && start < until_ms)

	return starts.length === 0 ? undefined : Math.min(...starts) - from_ms
}

function implement_durations(
	dispatches: ReadonlyArray<DispatchEntry>,
	stages: ReadonlyArray<StageEntry>,
): Array<number> {
	const sorted = dispatches.toSorted((left, right) => Date.parse(left.at) - Date.parse(right.at))

	return sorted
		.map((dispatch, index) => implement_ms(dispatch, next_dispatch_ms(sorted, index), stages))
		.filter(is_number)
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

function stage_row(stage: string, measured: Measured): string {
	const durations = durations_of(stage, measured)

	return lane_stats.to_row([
		stage,
		cell(lane_stats.median(durations)),
		cell(lane_stats.peak(durations)),
		String(durations.length),
	])
}

// The period's table: `entries` is the whole ledger, filtered here to `window`.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const period = lane_stats.in_window(entries, window)
	const stages = period.filter(is_stage)
	const measured = { implement: implement_durations(period.filter(is_dispatch), stages), stages }

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...STAGES.map((stage) => stage_row(stage, measured)),
	].join('\n')
}

const lane_stage_stats = {
	IMPLEMENT,
	NOT_MEASURED,
	STAGES,
	table,
}

export { lane_stage_stats }
