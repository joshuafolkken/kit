import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { review_round2 } from '#scripts/review/review-round2'
import {
	lane_ledger,
	type GateCheckRecord,
	type GateEntry,
	type LedgerEntry,
	type RoundTwoEntry,
} from './lane-ledger'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'

// How often each check caught something: one period's round 2 runs, gate checks and ship preflight checks
// reduced to one row per check — runs, catches, catch rate, minutes spent — and the rows whose rate
// says the check rarely pays for itself listed as `candidates:` (joshuafolkken/kit#7875). **It lists,
// never removes**: each candidate is retired, sampled or moved to a lighter path in an Issue of its own.
//
// - **Round 2**, per reason code of a `required` verdict: a run that reached a verdict records its
//   `findings` (joshuafolkken/kit#7873); a non-empty list is a catch. A record with no `findings` — one
//   written before they were recorded, or a run that reached no verdict — is counted under `no outcome`,
//   outside the rate.
// - **Gate checks**: a reused or unmoved check started nothing, so it is left out of the runs; a check
//   with only such rows prints `not measured`. A failed check is a catch; its minutes are `elapsed_ms`.
// - **Ship preflight checks**, per precondition kind: each evaluation is a run, an unmet kind a catch
//   (joshuafolkken/kit#7874).
//
// Round 2 and the preflight record no time, so their minutes print `not measured`.

// A check at or below this rate caught at most 1 run in 20: at the minimum count below, a single catch.
const CANDIDATE_RATE = 0.05
// The runs a row must cover before its rate is judged: under it one catch more or less swings the rate
// past the threshold. The same floor `rule:value` uses for a retirement (`rule-value-candidates.ts`).
const MIN_CANDIDATE_RUNS = 20
const PERCENT = 100
const DECIMALS = 1
const COLUMNS = ['catch rate', 'runs', 'caught', 'rate', 'minutes', 'no outcome'] as const
const NONE = 'none'
const SEPARATOR = ', '

interface CatchRow {
	label: string
	runs: number
	caught: number
	minutes?: number
	no_outcome: number
}

type PreflightEntry = Extract<LedgerEntry, { kind: typeof lane_ledger.KIND.PREFLIGHT }>

function is_round_two(entry: LedgerEntry): entry is RoundTwoEntry {
	return entry.kind === lane_ledger.KIND.ROUND_TWO
}

function is_gate(entry: LedgerEntry): entry is GateEntry {
	return entry.kind === lane_ledger.KIND.GATE
}

function is_preflight(entry: LedgerEntry): entry is PreflightEntry {
	return entry.kind === lane_ledger.KIND.PREFLIGHT
}

function distinct<T>(items: ReadonlyArray<T>): Array<T> {
	return [...new Set(items)]
}

function round_two_row(code: string, decisions: ReadonlyArray<RoundTwoEntry>): CatchRow {
	const of_code = decisions.filter((decision) => decision.code === code)
	const outcomes = of_code.flatMap((decision) => (decision.findings ? [decision.findings] : []))

	return {
		label: `round 2 ${code}`,
		runs: outcomes.length,
		caught: outcomes.filter((findings) => findings.length > 0).length,
		no_outcome: of_code.length - outcomes.length,
	}
}

function round_two_rows(entries: ReadonlyArray<LedgerEntry>): Array<CatchRow> {
	const required = entries
		.filter(is_round_two)
		.filter((decision) => decision.verdict === review_round2.REQUIRED_VERDICT)

	return distinct(required.map((decision) => decision.code)).map((code) =>
		round_two_row(code, required),
	)
}

function gate_row(label: string, checks: ReadonlyArray<GateCheckRecord>): CatchRow {
	const ran = checks.filter(
		(check) => check.label === label && check.is_reused !== true && check.is_unmoved !== true,
	)
	const elapsed_ms = ran.reduce((total, check) => total + check.elapsed_ms, 0)

	return {
		label,
		runs: ran.length,
		caught: ran.filter((check) => !check.is_passed).length,
		minutes: elapsed_ms / MS_PER_MINUTE,
		no_outcome: 0,
	}
}

function gate_rows(entries: ReadonlyArray<LedgerEntry>): Array<CatchRow> {
	const checks = entries.filter(is_gate).flatMap((gate) => gate.checks ?? [])

	return distinct(checks.map((check) => check.label)).map((label) => gate_row(label, checks))
}

function preflight_row(kind: string, records: ReadonlyArray<PreflightEntry>): CatchRow {
	const evaluated = records.filter((preflight) => preflight.evaluated.includes(kind))

	return {
		label: `preflight ${kind}`,
		runs: evaluated.length,
		caught: evaluated.filter((preflight) => preflight.unmet.includes(kind)).length,
		no_outcome: 0,
	}
}

function preflight_rows(entries: ReadonlyArray<LedgerEntry>): Array<CatchRow> {
	const records = entries.filter(is_preflight)
	const kinds = distinct(records.flatMap((preflight) => preflight.evaluated))

	return kinds.map((kind) => preflight_row(kind, records))
}

// The period's rows: `entries` is the whole ledger, filtered here to `window`.
function rows_of(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): Array<CatchRow> {
	const windowed = lane_stats.in_window(entries, window)

	return [...round_two_rows(windowed), ...gate_rows(windowed), ...preflight_rows(windowed)]
}

function rate_of(row: CatchRow): number | undefined {
	return row.runs === 0 ? undefined : row.caught / row.runs
}

function measured(value: number | undefined, scale = 1): string {
	return value === undefined ? lane_stage_stats.NOT_MEASURED : (value * scale).toFixed(DECIMALS)
}

function row_cells(row: CatchRow): Array<string> {
	return [
		row.label,
		String(row.runs),
		String(row.caught),
		measured(rate_of(row), PERCENT),
		measured(row.minutes),
		String(row.no_outcome),
	]
}

function is_candidate(row: CatchRow): boolean {
	const rate = rate_of(row)

	return rate !== undefined && row.runs >= MIN_CANDIDATE_RUNS && rate <= CANDIDATE_RATE
}

function candidates_line(rows: ReadonlyArray<CatchRow>): string {
	const labels = rows.filter((row) => is_candidate(row)).map((row) => row.label)
	const listed = labels.length === 0 ? NONE : labels.join(SEPARATOR)
	const bar = `rate ≤ ${measured(CANDIDATE_RATE, PERCENT)}%, runs ≥ ${String(MIN_CANDIDATE_RUNS)}`

	return ['candidates:', `  low catch rate (${bar}): ${listed}`].join('\n')
}

// A period with no record still prints the table, so a reader sees zero rather than no table.
const NONE_ROW: CatchRow = { label: NONE, runs: 0, caught: 0, no_outcome: 0 }

// The period's table and its candidates; `rate` is a percentage.
function table(entries: ReadonlyArray<LedgerEntry>, window: StatsWindow): string {
	const rows = rows_of(entries, window)
	const printed = rows.length === 0 ? [NONE_ROW] : rows

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...printed.map((row) => lane_stats.to_row(row_cells(row))),
		'',
		candidates_line(rows),
	].join('\n')
}

const lane_catch_rate_stats = { MIN_CANDIDATE_RUNS, table }

export { lane_catch_rate_stats }
