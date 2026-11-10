import path from 'node:path'
import { lane_breakdown, type Breakdown } from './lane-breakdown'
import { lane_implement_signals } from './lane-implement-signals'
import { lane_sinks, type SinkRecords } from './lane-sinks'
import type { OpenIssue } from './lane-sinks-issues'
import type { BudgetStage } from './lane-stage-budget'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import { lane_why } from './lane-why'
import { lane_why_causes } from './lane-why-causes'

// Evidence groups, not exclusive diagnoses: a lane may have several signals. Each group's total
// is the full net time of its distinct lanes, never an estimate of time a fix would save (#6475).
// The followup is outside the net time, so its overrun is the driver's, a row apart from the lane's
// causes (joshuafolkken/kit#6541). An implement or ship overrun is a row per cause key — `lane:why`'s
// own keys (joshuafolkken/kit#6988) — so only a lane that recorded no implement signals stays unverified.
const CAUSE = {
	IMPLEMENT: 'implement (attribution unverified)',
	IMPLEMENT_CLEAR: 'implement (no signal over its bar)',
	DRIVER: 'driver followup over budget (outside lane net)',
	PAUSE: 'pause',
	HUB: 'hub over cap',
	OTHER: 'other',
} as const
const COLUMNS = ['cause', 'lanes', 'total net min', 'open issues']
const KEY_SEPARATOR = ': '

interface CauseLane {
	ms: number
	names: ReadonlyArray<string>
}

// A lane's cause keys: its ship's from the ledger alone (no ship log is read for a period), and its
// implement signals' — `undefined` when it recorded none.
interface LaneKeys {
	ship: ReadonlyArray<string>
	implement?: ReadonlyArray<string> | undefined
}

const NO_KEYS: LaneKeys = { ship: [] }

type CauseRow = readonly [cause: string, names: ReadonlyArray<string>]

// A row per key, each linked by its key; `fallback` named by the stage when no key is known.
function keyed_rows(
	budget: BudgetStage,
	keys: ReadonlyArray<string>,
	fallback: string,
	name: string,
): Array<CauseRow> {
	if (keys.length === 0) return [[fallback, [name]]]

	return keys.map((key) => [`${budget}${KEY_SEPARATOR}${key}`, [key]])
}

function rows_of(budget: BudgetStage, name: string, keys: LaneKeys): Array<CauseRow> {
	if (budget === 'followup') return [[CAUSE.DRIVER, [name]]]
	if (budget === 'ship') return keyed_rows(budget, keys.ship, budget, name)
	if (budget !== 'implement') return [[budget, [name]]]
	if (keys.implement === undefined) return [[CAUSE.IMPLEMENT, [name]]]

	return keyed_rows(budget, keys.implement, CAUSE.IMPLEMENT_CLEAR, name)
}

function add_names(
	groups: Map<string, Array<string>>,
	cause: string,
	names: ReadonlyArray<string>,
): void {
	groups.set(cause, [...(groups.get(cause) ?? []), ...names])
}

function add_signals(
	groups: Map<string, Array<string>>,
	breakdown: Breakdown,
	hubs: ReadonlyArray<string>,
): void {
	const names = hubs.map((hub) => path.basename(hub))

	if ((breakdown.pauses?.length ?? 0) > 0) add_names(groups, CAUSE.PAUSE, ['pause'])
	if (names.length > 0) groups.set(CAUSE.HUB, names)
}

// The driver row also carries the lane's cause keys, so an Issue filed against the cause rather than
// the stage name is linked (joshuafolkken/kit#6952).
function add_driver_keys(groups: Map<string, Array<string>>, keys: ReadonlyArray<string>): void {
	const names = groups.get(CAUSE.DRIVER)

	if (names !== undefined) groups.set(CAUSE.DRIVER, [...names, ...keys])
}

// An over-budget implement row without recorded signals cannot prove misattribution; retain that
// uncertainty.
function causes_of(
	breakdown: Breakdown,
	hubs: ReadonlyArray<string>,
	keys: LaneKeys = NO_KEYS,
): Map<string, Array<string>> {
	const groups = new Map<string, Array<string>>()
	const rows = lane_why
		.over_stages(breakdown)
		.flatMap(({ stage, budget }) => rows_of(budget, lane_sinks.base_name(stage.name), keys))

	for (const [cause, names] of rows) add_names(groups, cause, names)

	add_driver_keys(groups, keys.ship)
	add_signals(groups, breakdown, hubs)
	// The driver's overrun explains none of the lane's own net time.
	if (groups.size === Number(groups.has(CAUSE.DRIVER))) groups.set(CAUSE.OTHER, [])

	return groups
}

function keys_of(records: SinkRecords, issue: number): LaneKeys {
	const signals = lane_implement_signals.signals_of(records.events, issue)

	return {
		ship: lane_why_causes.keys_of(records.entries, issue, undefined),
		implement: signals === undefined ? undefined : lane_implement_signals.keys_of(signals),
	}
}

function collect_lane(
	groups: Map<string, Array<CauseLane>>,
	records: SinkRecords,
	issue: number,
): void {
	const breakdown = lane_breakdown.of(records.entries, records.events, issue)

	if (breakdown === undefined) return

	const ms = breakdown.stages.reduce((sum, stage) => sum + stage.ms, 0)
	const causes = causes_of(
		breakdown,
		lane_sinks.hubs_of(records.entries, [issue]),
		keys_of(records, issue),
	)

	for (const [cause, names] of causes) {
		groups.set(cause, [...(groups.get(cause) ?? []), { ms, names }])
	}
}

function total_ms(lanes: ReadonlyArray<CauseLane>): number {
	return lanes.reduce((sum, lane) => sum + lane.ms, 0)
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
		lane_why_causes.open_cell(
			lanes.flatMap((lane) => lane.names),
			issues,
		),
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
