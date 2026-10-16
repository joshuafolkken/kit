import { lane_ledger, type GateCheckRecord, type GateEntry, type LedgerEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'

// Which check a gate waited on: the ledger's per-check rows of one period reduced to one row per check
// — median, maximum, how many runs and how many were reused — printed last by `josh lane:stats`. The
// rows are in the order the checks first appear.
//
// **A reused check is counted, never timed.** It started no process, so its zero would pull the median
// toward a check that never ran; a check with only reused rows prints `not measured`.

const MS_PER_SECOND = 1000
const DECIMALS = 1
const COLUMNS = ['check', 'median (s)', 'max (s)', 'runs', 'reused'] as const

function is_gate(entry: LedgerEntry): entry is GateEntry {
	return entry.kind === lane_ledger.KIND.GATE
}

function cell(milliseconds: number | undefined): string {
	return milliseconds === undefined
		? lane_stage_stats.NOT_MEASURED
		: (milliseconds / MS_PER_SECOND).toFixed(DECIMALS)
}

function check_row(label: string, checks: ReadonlyArray<GateCheckRecord>): string {
	const runs = checks.filter((check) => check.label === label)
	const timed = runs.filter((check) => check.is_reused !== true).map((check) => check.elapsed_ms)

	return lane_stats.to_row([
		label,
		cell(lane_stats.median(timed)),
		cell(lane_stats.peak(timed)),
		String(runs.length),
		String(runs.length - timed.length),
	])
}

// The period's table: `entries` is the whole ledger, filtered here to `window`.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const checks = lane_stats
		.in_window(entries, window)
		.filter(is_gate)
		.flatMap((gate) => gate.checks ?? [])
	const labels = [...new Set(checks.map((check) => check.label))]

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...labels.map((label) => check_row(label, checks)),
	].join('\n')
}

const lane_check_stats = { table }

export { lane_check_stats }
