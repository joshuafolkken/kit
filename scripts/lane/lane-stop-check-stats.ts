import { issue_cite } from '#scripts/issue/issue-cite'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'
import { run_ship_stop_cause } from '#scripts/run/ship/run-ship-stop-cause'
import type { LedgerEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import { lane_stop_stats, type StopWait } from './lane-stop-stats'

// What the stop table's waits were spent on (joshuafolkken/kit#7333), printed by `josh lane:stats` under
// it: the period's followup `check` stops by the CI check that failed — so the check worth fixing first
// is a number — and the period's longest stops, each with its issue and the instant it stopped, so a
// wait that ran overnight or on a person reads as itself. The waits are the stop table's own
// (`lane-stop-stats.ts`).

const CHECK_COLUMNS = [
	'failed check',
	'stops',
	'wait total (min)',
	'wait max (min)',
	'not resumed',
] as const
const LONGEST_COLUMNS = ['longest stop', 'issue', 'stopped at', 'causes', 'wait (min)'] as const
const LONGEST_ROWS = 10
// A followup check stop recorded before it named its checks, or whose wait named none.
const NO_CHECK = 'none named'
const CAUSE_SEPARATOR = ', '
const { STAGE } = run_ship_stage
const { CAUSE } = run_ship_stop_cause

function is_followup_check({ stop }: StopWait): boolean {
	return stop.reason === STAGE.FOLLOWUP && stop.cause === CAUSE.CHECK
}

function checks_of({ stop }: StopWait): ReadonlyArray<string> {
	return stop.checks ?? [NO_CHECK]
}

interface CheckRow {
	cells: Array<string>
	total_ms: number
}

// One failed check's row; a stop that named two checks counts once under each.
function check_row(check: string, waits: ReadonlyArray<StopWait>): CheckRow {
	const of_check = waits.filter((wait) => checks_of(wait).includes(check))
	const ended = of_check
		.map((wait) => wait.wait_ms)
		.filter((value) => lane_stage_stats.is_number(value))
	const total = lane_stop_stats.total(ended)
	const cells = [
		check,
		String(of_check.length),
		lane_stage_stats.cell(total),
		lane_stage_stats.cell(lane_stats.peak(ended)),
		String(of_check.length - ended.length),
	]

	return { cells, total_ms: total ?? 0 }
}

function header(columns: ReadonlyArray<string>): Array<string> {
	return [lane_stats.to_row(columns), lane_stats.to_row(columns.map(() => '---'))]
}

// The period's followup check stops by failed check, the longest total wait first.
function check_table(
	entries: ReadonlyArray<LedgerEntry>,
	window: StatsWindow,
	events: ReadonlyArray<RunEvent> = [],
): string {
	const waits = lane_stop_stats
		.waits_in(entries, window, events)
		.filter((wait) => is_followup_check(wait))
	const checks = new Set(waits.flatMap((wait) => checks_of(wait)))
	const rows = [...checks].map((check) => check_row(check, waits))
	const ranked = rows.toSorted((left, right) => right.total_ms - left.total_ms)

	return [...header(CHECK_COLUMNS), ...ranked.map(({ cells }) => lane_stats.to_row(cells))].join(
		'\n',
	)
}

// A followup check stop's failed checks, any other stop's causes.
function causes_cell(wait: StopWait): string {
	return (is_followup_check(wait) ? checks_of(wait) : wait.causes).join(CAUSE_SEPARATOR)
}

function longest_row(wait: StopWait): string {
	return lane_stats.to_row([
		wait.reason,
		issue_cite.plain_for('terminal', wait.stop.issue),
		wait.stop.at,
		causes_cell(wait),
		lane_stage_stats.cell(wait.wait_ms),
	])
}

// The period's ended stops, the longest wait first, at most `LONGEST_ROWS` of them.
function longest_table(
	entries: ReadonlyArray<LedgerEntry>,
	window: StatsWindow,
	events: ReadonlyArray<RunEvent> = [],
): string {
	const ended = lane_stop_stats
		.waits_in(entries, window, events)
		.filter((wait) => lane_stage_stats.is_number(wait.wait_ms))
	const ranked = ended.toSorted((left, right) => (right.wait_ms ?? 0) - (left.wait_ms ?? 0))

	const rows = ranked.slice(0, LONGEST_ROWS).map((wait) => longest_row(wait))

	return [...header(LONGEST_COLUMNS), ...rows].join('\n')
}

const lane_stop_check_stats = { LONGEST_ROWS, NO_CHECK, check_table, longest_table }

export { lane_stop_check_stats }
