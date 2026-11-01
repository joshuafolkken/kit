import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import type { LedgerEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import { lane_stop_stats } from './lane-stop-stats'

// Each lane's `run:cut`s by the phase it cut at (joshuafolkken/kit#5661). A cut event reads
// `#<N> cut (<phase>)`, and the phase is the only attribution `run:cut` records, so a cut is counted
// under it — `lane:breakdown` prints one lane's line, `lane:stats` the period's table.

const CUT_PHASE = /cut \(([^)]+)\)$/u
const UNKNOWN_PHASE = 'unknown'
const ALL = 'all'
const COLUMNS = ['cuts', 'per lane median', 'per lane max', 'total'] as const

interface Cut {
	issue: number
	phase: string
}

function cuts_of(events: ReadonlyArray<RunEvent>): Array<Cut> {
	return events
		.filter((event) => event.kind === run_event_stream.EVENT_KIND.CUT)
		.map((event) => ({
			issue: lane_stop_stats.issue_of(event),
			phase: CUT_PHASE.exec(event.text)?.[1] ?? UNKNOWN_PHASE,
		}))
}

// The phases cut at, in name order so a table's rows stay put between runs.
function phases_of(cuts: ReadonlyArray<Cut>): Array<string> {
	return [...new Set(cuts.map((cut) => cut.phase))].toSorted((left, right) =>
		left.localeCompare(right),
	)
}

function count_text(name: string, count: number): string {
	return `${name} ×${String(count)}`
}

// One lane's cuts as `run:cut ×3 (implementation ×2, pre-gate ×1)`, or `undefined` when it cut none.
function line(events: ReadonlyArray<RunEvent>, issue: number): string | undefined {
	const cuts = cuts_of(events).filter((cut) => cut.issue === issue)

	if (cuts.length === 0) return undefined

	const causes = phases_of(cuts).map((phase) =>
		count_text(phase, cuts.filter((cut) => cut.phase === phase).length),
	)

	return `${count_text('run:cut', cuts.length)} (${causes.join(', ')})`
}

// The lanes the period counts: every lane dispatched in it, and every lane that cut in it.
function lanes_of(entries: ReadonlyArray<LedgerEntry>, cuts: ReadonlyArray<Cut>): Array<number> {
	const dispatched = entries.filter((entry) => lane_stage_stats.is_dispatch(entry))

	return [...new Set([...dispatched.map((entry) => entry.issue), ...cuts.map((cut) => cut.issue)])]
}

function count_cell(value: number | undefined): string {
	return value === undefined ? lane_stats.MISSING : String(value)
}

function row(name: string, lanes: ReadonlyArray<number>, cuts: ReadonlyArray<Cut>): string {
	const per_lane = lanes.map((issue) => cuts.filter((cut) => cut.issue === issue).length)

	return lane_stats.to_row([
		name,
		count_cell(lane_stats.median(per_lane)),
		count_cell(lane_stats.peak(per_lane)),
		String(cuts.length),
	])
}

function table(
	entries: ReadonlyArray<LedgerEntry>,
	window: StatsWindow,
	events: ReadonlyArray<RunEvent>,
): string {
	const cuts = cuts_of(lane_stats.in_window(events, window))
	const lanes = lanes_of(lane_stats.in_window(entries, window), cuts)
	const phase_rows = phases_of(cuts).map((phase) =>
		row(
			phase,
			lanes,
			cuts.filter((cut) => cut.phase === phase),
		),
	)

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		row(ALL, lanes, cuts),
		...phase_rows,
	].join('\n')
}

const lane_cut_stats = { line, table }

export { lane_cut_stats }
