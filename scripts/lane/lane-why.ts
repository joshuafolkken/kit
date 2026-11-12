import type { TimingAnswer } from '#scripts/ci/ci-timing'
import { size_estimate } from '#scripts/issue/size-estimate'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { lane_breakdown, type Breakdown, type Stage } from './lane-breakdown'
import { lane_breakdown_related } from './lane-breakdown-related'
import { lane_breakdown_text } from './lane-breakdown-text'
import { lane_ci_path_stats } from './lane-ci-path-stats'
import type { ImplementRate } from './lane-implement-rate'
import { lane_implement_signals } from './lane-implement-signals'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import { lane_sinks } from './lane-sinks'
import type { OpenIssue } from './lane-sinks-issues'
import type { SizeRatios } from './lane-size-stats'
import { lane_stage_budget, type BudgetStage } from './lane-stage-budget'
import { lane_stats } from './lane-stats'
import { lane_why_causes } from './lane-why-causes'
import { lane_why_ci } from './lane-why-ci'

// `josh lane:why <issue>` (joshuafolkken/kit#6120): one row per stage of a merged lane that ran past
// its budget, each beside the records that say why — the join a person made by hand over
// `lane:breakdown`, the filing's projection, the followup's last check, the ship's stops and
// `lane:stats --sinks`. A record that is missing leaves its cell blank; an unread Issue listing
// prints `unread`.

const COLUMNS = [
	'stage',
	'min',
	'budget',
	'projected',
	'CI',
	'ship',
	'causes',
	'open issues',
	'unfiled',
]
const BLANK = ''
const SHIP_SEPARATOR = '; '
const KEY_SEPARATOR = ', '
// The budgets whose overrun the ship's cause keys explain (joshuafolkken/kit#6679).
const SHIP_BUDGETS: ReadonlySet<BudgetStage> = new Set(['ship', 'followup'])

interface WhyRecords {
	issue: number
	entries: ReadonlyArray<LedgerEntry>
	// The run events, read for the implement signals.
	events: ReadonlyArray<RunEvent>
	breakdown: Breakdown
	// The filing's projected implement minutes, `undefined` with no estimate or measured rate.
	projected: number | undefined
	// The open Issues, `undefined` when the listing was unreadable.
	issues: ReadonlyArray<OpenIssue> | undefined
	// The lane branch's CI timing, `undefined` when `ci:timing` was unreadable.
	timing: TimingAnswer | undefined
	// The ship log's last launch, `undefined` when it is gone.
	log: string | undefined
}

type StopRow = Extract<LedgerEntry, { kind: typeof lane_ledger.KIND.STOP }>

interface OverStage {
	stage: Stage
	budget: BudgetStage
}

// The implement minutes the Issue's declared size projects at `rate` — `issue:file`'s own projection.
function projected_of(
	body: string | undefined,
	rate: ImplementRate | undefined,
	growth?: SizeRatios,
): number | undefined {
	const estimate = body === undefined ? undefined : size_estimate.declared_size(body)

	if (estimate === undefined || rate === undefined) return undefined

	return size_estimate.projected_minutes(estimate, rate, growth)
}

function over_of(stage: Stage): OverStage | undefined {
	const budget = lane_breakdown_text.budget_of(stage.name)

	if (budget === undefined) return undefined

	return lane_stage_budget.over_minutes(budget, stage.ms) === undefined
		? undefined
		: { stage, budget }
}

// Shared by the single-lane explanation and the period-wide triage; the driver's followup, outside the
// net time, last.
function over_stages(breakdown: Breakdown): Array<OverStage> {
	return [...breakdown.stages, ...(breakdown.driver ?? [])]
		.map((stage) => over_of(stage))
		.filter((row) => row !== undefined)
}

function is_stop(entry: LedgerEntry, issue: number): entry is StopRow {
	return entry.kind === lane_ledger.KIND.STOP && entry.issue === issue
}

// The ship's stop reasons and its `test:related` cap overrun.
function ship_cell(records: WhyRecords): string {
	const stops = records.entries
		.filter((entry) => is_stop(entry, records.issue))
		.map((entry) => entry.reason)
	const related = lane_breakdown_related.over_cap_text(records.entries, records.issue)

	return [...stops, related].filter((part) => part !== BLANK).join(SHIP_SEPARATOR)
}

// The followup's last check and the lane's longest CI job and step.
function ci_cell(records: WhyRecords): string {
	const last_check = lane_ci_path_stats.last_check_text(records.entries, records.issue).trim()

	return [last_check, lane_why_ci.cell(records.timing)]
		.filter((part) => part !== BLANK)
		.join(SHIP_SEPARATOR)
}

function projected_cell(records: WhyRecords): string {
	return records.projected === undefined ? BLANK : `${records.projected.toFixed(1)} min`
}

// An implement row's keys from its recorded signals (joshuafolkken/kit#6983); `undefined` when it
// recorded none or none passed its bar, so the row falls back to the Issues naming its stage.
function implement_keys(records: WhyRecords): Array<string> | undefined {
	const signals = lane_implement_signals.signals_of(records.events, records.issue)
	const keys = signals === undefined ? [] : lane_implement_signals.keys_of(signals)

	return keys.length === 0 ? undefined : keys
}

// A ship row's keys from its log and ledger, an implement row's from its signals; `undefined` for
// any other row.
function keys_of(budget: BudgetStage, records: WhyRecords): Array<string> | undefined {
	if (SHIP_BUDGETS.has(budget)) {
		return lane_why_causes.keys_of(records.entries, records.issue, records.log)
	}

	return budget === 'implement' ? implement_keys(records) : undefined
}

// A keyed row's cause keys, its open Issues and the keys none names; any other row's open Issues
// name its stage (joshuafolkken/kit#6679).
function cause_cells({ stage, budget }: OverStage, records: WhyRecords): Array<string> {
	const keys = keys_of(budget, records)

	if (keys === undefined) {
		return [
			BLANK,
			lane_why_causes.open_cell([lane_sinks.base_name(stage.name)], records.issues),
			BLANK,
		]
	}

	return [
		keys.join(KEY_SEPARATOR),
		lane_why_causes.open_cell(keys, records.issues),
		lane_why_causes.unfiled_cell(keys, records.issues),
	]
}

function row_of(over: OverStage, records: WhyRecords): string {
	const { stage, budget } = over

	return lane_stats.to_row([
		stage.name,
		lane_breakdown.minutes_text(stage.ms),
		`${String(lane_stage_budget.BUDGET_MINUTES[budget])} min`,
		budget === 'implement' ? projected_cell(records) : BLANK,
		budget === 'followup' ? ci_cell(records) : BLANK,
		budget === 'ship' ? ship_cell(records) : BLANK,
		...cause_cells(over, records),
	])
}

// The table of the stages over budget, longest first; `undefined` when none ran over.
function table(records: WhyRecords): string | undefined {
	const over = over_stages(records.breakdown)

	if (over.length === 0) return undefined

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...over.map((row) => row_of(row, records)),
	].join('\n')
}

const lane_why = { over_stages, projected_of, table }

export { lane_why }
export type { WhyRecords }
