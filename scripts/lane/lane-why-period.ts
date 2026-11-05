import path from 'node:path'
import { lane_breakdown, type Breakdown } from './lane-breakdown'
import { lane_sinks, type SinkRecords } from './lane-sinks'
import { lane_sinks_issues, type OpenIssue } from './lane-sinks-issues'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import { lane_why } from './lane-why'

// Evidence groups, not exclusive diagnoses: a lane may have several signals. Each group's total
// is the full net time of its distinct lanes, never an estimate of time a fix would save (#6475).
const CAUSE = {
	IMPLEMENT: 'implement (attribution unverified)',
	CI: 'CI wait',
	PAUSE: 'pause',
	HUB: 'hub over cap',
	OTHER: 'other',
} as const
const COLUMNS = ['cause', 'lanes', 'total net min', 'open issues']

interface CauseLane {
	ms: number
	names: ReadonlyArray<string>
}

function cause_of(budget: string): string {
	if (budget === 'implement') return CAUSE.IMPLEMENT
	if (budget === 'followup') return CAUSE.CI

	return CAUSE.OTHER
}

function add_name(groups: Map<string, Array<string>>, cause: string, name: string): void {
	groups.set(cause, [...(groups.get(cause) ?? []), name])
}

function add_signals(
	groups: Map<string, Array<string>>,
	breakdown: Breakdown,
	hubs: ReadonlyArray<string>,
): void {
	const names = hubs.map((hub) => path.basename(hub))

	if ((breakdown.pauses?.length ?? 0) > 0) add_name(groups, CAUSE.PAUSE, 'pause')
	if (names.length > 0) groups.set(CAUSE.HUB, names)
}

// An over-budget implement row alone cannot prove misattribution; retain that uncertainty.
function causes_of(breakdown: Breakdown, hubs: ReadonlyArray<string>): Map<string, Array<string>> {
	const groups = new Map<string, Array<string>>()

	for (const { stage, budget } of lane_why.over_stages(breakdown)) {
		add_name(groups, cause_of(budget), lane_sinks.base_name(stage.name))
	}

	add_signals(groups, breakdown, hubs)
	if (groups.size === 0) groups.set(CAUSE.OTHER, [])

	return groups
}

function collect_lane(
	groups: Map<string, Array<CauseLane>>,
	records: SinkRecords,
	issue: number,
): void {
	const breakdown = lane_breakdown.of(records.entries, records.events, issue)

	if (breakdown === undefined) return

	const ms = breakdown.stages.reduce((sum, stage) => sum + stage.ms, 0)
	const causes = causes_of(breakdown, lane_sinks.hubs_of(records.entries, [issue]))

	for (const [cause, names] of causes) {
		groups.set(cause, [...(groups.get(cause) ?? []), { ms, names }])
	}
}

function total_ms(lanes: ReadonlyArray<CauseLane>): number {
	return lanes.reduce((sum, lane) => sum + lane.ms, 0)
}

function issues_cell(
	lanes: ReadonlyArray<CauseLane>,
	issues: ReadonlyArray<OpenIssue> | undefined,
): string {
	if (issues === undefined) return lane_sinks_issues.UNREAD

	const [name, ...also] = lanes.flatMap((lane) => lane.names)

	return name === undefined ? lane_sinks_issues.NONE : lane_sinks_issues.cell(name, issues, also)
}

function row_of(
	cause: string,
	lanes: ReadonlyArray<CauseLane>,
	issues: ReadonlyArray<OpenIssue> | undefined,
): string {
	return lane_stats.to_row([
		cause,
		String(lanes.length),
		lane_stage_stats.cell(total_ms(lanes)),
		issues_cell(lanes, issues),
	])
}

function table(
	records: SinkRecords,
	window: StatsWindow,
	minutes: number,
	issues: ReadonlyArray<OpenIssue> | undefined,
): string {
	const groups = new Map<string, Array<CauseLane>>()

	for (const issue of lane_sinks.over_issues(records, window, minutes)) {
		collect_lane(groups, records, issue)
	}

	const ranked = [...groups].toSorted((left, right) => total_ms(right[1]) - total_ms(left[1]))

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...ranked.map(([cause, lanes]) => row_of(cause, lanes, issues)),
	].join('\n')
}

const lane_why_period = { CAUSE, causes_of, table }

export { lane_why_period }
