import type { TimingAnswer } from '#scripts/ci/ci-timing'
import { size_estimate } from '#scripts/issue/size-estimate'
import { lane_breakdown, type Breakdown, type Stage } from './lane-breakdown'
import { lane_breakdown_related } from './lane-breakdown-related'
import { lane_breakdown_text } from './lane-breakdown-text'
import { lane_ci_path_stats } from './lane-ci-path-stats'
import type { ImplementRate } from './lane-implement-rate'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import { lane_sinks } from './lane-sinks'
import { lane_sinks_issues, type OpenIssue } from './lane-sinks-issues'
import type { SizeRatios } from './lane-size-stats'
import { lane_stage_budget, type BudgetStage } from './lane-stage-budget'
import { lane_stats } from './lane-stats'
import { lane_why_ci } from './lane-why-ci'

// `josh lane:why <issue>` (joshuafolkken/kit#6120): one row per stage of a merged lane that ran past
// its budget, each beside the records that say why — the join a person made by hand over
// `lane:breakdown`, the filing's projection, the followup's last check, the ship's stops and
// `lane:stats --sinks`. A record that is missing leaves its cell blank.

const COLUMNS = ['stage', 'min', 'budget', 'projected', 'CI', 'ship', 'open issues']
const BLANK = ''
const SHIP_SEPARATOR = '; '

interface WhyRecords {
	issue: number
	entries: ReadonlyArray<LedgerEntry>
	breakdown: Breakdown
	// The filing's projected implement minutes, `undefined` with no estimate or measured rate.
	projected: number | undefined
	// The open Issues, `undefined` when the listing was unreadable.
	issues: ReadonlyArray<OpenIssue> | undefined
	// The lane branch's CI timing, `undefined` when `ci:timing` was unreadable.
	timing: TimingAnswer | undefined
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

// Shared by the single-lane explanation and the period-wide triage.
function over_stages(breakdown: Breakdown): Array<OverStage> {
	return breakdown.stages.map((stage) => over_of(stage)).filter((row) => row !== undefined)
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

function issues_cell(name: string, issues: WhyRecords['issues']): string {
	return issues === undefined ? BLANK : lane_sinks_issues.cell(lane_sinks.base_name(name), issues)
}

function row_of({ stage, budget }: OverStage, records: WhyRecords): string {
	return lane_stats.to_row([
		stage.name,
		lane_breakdown.minutes_text(stage.ms),
		`${String(lane_stage_budget.BUDGET_MINUTES[budget])} min`,
		budget === 'implement' ? projected_cell(records) : BLANK,
		budget === 'followup' ? ci_cell(records) : BLANK,
		budget === 'ship' ? ship_cell(records) : BLANK,
		issues_cell(stage.name, records.issues),
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
