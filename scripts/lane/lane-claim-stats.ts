import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { lane_ledger, type GateCheckRecord, type GateEntry, type LedgerEntry } from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import { lane_tail_stats } from './lane-tail-stats'

// What each gate check claimed from the core budget against what it used (joshuafolkken/kit#5138): one
// period's per-check rows reduced to one row per check — the median cores requested, then the cores it
// kept busy (`cpu_ms ÷ elapsed_ms`) as a median, a 90th percentile and a maximum, and the seconds its
// claims waited. The weights in `scripts/gate/core-weights.ts` are changed from this table, never by it.
//
// **Only a measured run is counted**: a reused check started no process, and a check with no `cpu_ms`
// was recorded before the field existed, so neither says how many cores the check used.

const DECIMALS = 1
const COLUMNS = [
	'check',
	'claim',
	'runs',
	'cores median',
	'cores p90',
	'cores max',
	'wait (s)',
] as const
const { NOT_MEASURED } = lane_stage_stats

interface MeasuredCheck {
	label: string
	elapsed_ms: number
	cpu_ms: number
	claim?: GateCheckRecord['claim']
}

function is_gate(entry: LedgerEntry): entry is GateEntry {
	return entry.kind === lane_ledger.KIND.GATE
}

function is_measured(check: GateCheckRecord): check is GateCheckRecord & MeasuredCheck {
	return check.is_reused !== true && check.cpu_ms !== undefined && check.elapsed_ms > 0
}

function number_cell(value: number | undefined): string {
	return value === undefined ? NOT_MEASURED : value.toFixed(DECIMALS)
}

function seconds_cell(milliseconds: number | undefined): string {
	return number_cell(milliseconds === undefined ? undefined : milliseconds / MS_PER_SECOND)
}

function total(values: ReadonlyArray<number>): number {
	return values.reduce((sum, value) => sum + value, 0)
}

function check_row(label: string, checks: ReadonlyArray<MeasuredCheck>): string {
	const runs = checks.filter((check) => check.label === label)
	const cores = runs.map((check) => check.cpu_ms / check.elapsed_ms)
	const claims = runs.map((check) => check.claim).filter((claim) => claim !== undefined)
	const requested = claims.map((claim) => claim.requested)
	const waited_ms = claims.length === 0 ? undefined : total(claims.map((claim) => claim.waited_ms))

	return lane_stats.to_row([
		label,
		number_cell(lane_stats.median(requested)),
		String(runs.length),
		number_cell(lane_stats.median(cores)),
		number_cell(lane_tail_stats.tail_minutes(cores)),
		number_cell(lane_stats.peak(cores)),
		seconds_cell(waited_ms),
	])
}

// The period's table: `entries` is the whole ledger, filtered here to `window`.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const gates = lane_stats.in_window(entries, window).filter(is_gate)
	const checks = gates.flatMap((gate) => gate.checks ?? []).filter(is_measured)
	const labels = [...new Set(checks.map((check) => check.label))]
	const header = [lane_stats.to_row(COLUMNS), lane_stats.to_row(COLUMNS.map(() => '---'))]

	return [...header, ...labels.map((label) => check_row(label, checks))].join('\n')
}

const lane_claim_stats = { table }

export { lane_claim_stats }
