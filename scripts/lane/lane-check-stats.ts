import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { lane_ledger, type GateCheckRecord, type GateEntry, type LedgerEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'

// Which check a gate waited on: one period's per-check rows reduced to one row per check — median,
// maximum, runs, reuses, no-ops and whole-suite fallbacks — printed by `josh lane:stats`.
//
// The whole gate is the first row, since its reuse started no check (joshuafolkken/kit#4397); the
// checks follow in the order they first appear.
//
// **A reused check is counted, never timed.** It started no process, so its zero would pull the median
// toward a check that never ran; a check with only reused rows prints `not measured`. **The unit leg's
// since-green no-op is counted the same way** (joshuafolkken/kit#4457): it ran no test, so its second
// would stand for a run that tested nothing.
//
// **The fallbacks are broken down by why** in a second table, one row per reason kind, so a slow unit
// leg can be read as the full suite it ran and the reason it had to.

const DECIMALS = 1
const WHOLE_GATE_LABEL = 'gate (whole)'
const COLUMNS = ['check', 'median (s)', 'max (s)', 'runs', 'reused', 'no-op', 'fallback'] as const
const FALLBACK_COLUMNS = ['fallback reason', 'runs'] as const

function is_gate(entry: LedgerEntry): entry is GateEntry {
	return entry.kind === lane_ledger.KIND.GATE
}

function cell(milliseconds: number | undefined): string {
	return milliseconds === undefined
		? lane_stage_stats.NOT_MEASURED
		: (milliseconds / MS_PER_SECOND).toFixed(DECIMALS)
}

function header(columns: ReadonlyArray<string>): Array<string> {
	return [lane_stats.to_row(columns), lane_stats.to_row(columns.map(() => '---'))]
}

function count(
	runs: ReadonlyArray<GateCheckRecord>,
	is_counted: (check: GateCheckRecord) => boolean,
): string {
	return String(runs.filter((check) => is_counted(check)).length)
}

function check_row(label: string, checks: ReadonlyArray<GateCheckRecord>): string {
	const runs = checks.filter((check) => check.label === label)
	const timed = runs.filter((check) => check.is_reused !== true && check.is_unmoved !== true)
	const elapsed = timed.map((check) => check.elapsed_ms)

	return lane_stats.to_row([
		label,
		cell(lane_stats.median(elapsed)),
		cell(lane_stats.peak(elapsed)),
		String(runs.length),
		count(runs, (check) => check.is_reused === true),
		count(runs, (check) => check.is_unmoved === true),
		count(runs, (check) => check.fallback !== undefined),
	])
}

// The whole gate read as one more check, so its reuse is counted the way a check's is.
function whole_gate(gate: GateEntry): GateCheckRecord {
	return {
		label: WHOLE_GATE_LABEL,
		elapsed_ms: gate.elapsed_ms,
		is_passed: gate.is_passed,
		is_reused: gate.is_reused,
	}
}

function fallback_table(checks: ReadonlyArray<GateCheckRecord>): string {
	const reasons = checks.map((check) => check.fallback).filter((reason) => reason !== undefined)
	const kinds = [...new Set(reasons)]
	const rows = kinds.map((kind) =>
		lane_stats.to_row([kind, String(reasons.filter((reason) => reason === kind).length)]),
	)

	return [...header(FALLBACK_COLUMNS), ...rows].join('\n')
}

// The period's tables: `entries` is the whole ledger, filtered here to `window`.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const gates = lane_stats.in_window(entries, window).filter(is_gate)
	const checks = gates.flatMap((gate) => gate.checks ?? [])
	const rows = [...gates.map((gate) => whole_gate(gate)), ...checks]
	const labels = [...new Set(rows.map((row) => row.label))]

	return [
		[...header(COLUMNS), ...labels.map((label) => check_row(label, rows))].join('\n'),
		fallback_table(checks),
	].join('\n\n')
}

const lane_check_stats = { WHOLE_GATE_LABEL, table }

export { lane_check_stats }
