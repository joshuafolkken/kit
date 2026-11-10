import path from 'node:path'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { lane_net_time } from './lane-net-time'
import { lane_over } from './lane-over'
import { lane_sinks, type SinkRecords } from './lane-sinks'
import { lane_sinks_issues, type OpenIssue } from './lane-sinks-issues'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import { lane_why_causes } from './lane-why-causes'

// `josh lane:stats --over`'s cause table (joshuafolkken/kit#6985): the period's lanes over the
// threshold grouped by each hub that put `test:related` past its cap and by each CI job key
// (`lane-why-causes.ts`), one row per cause with its lane count and summed overrun. A cause an open
// Issue names carries its `#N`; only the rest are filing candidates.

const KIND = { HUB: 'hub', JOB: 'ci job' } as const
const COLUMNS = ['kind', 'cause', 'lanes', 'over min', 'open issues']
const CANDIDATES = 'filing candidates: '
const NAME_SEPARATOR = ', '

interface LaneCause {
	kind: string
	key: string
	// The word an open Issue's title names this cause by — a hub by its file name.
	word: string
}

interface OverCause extends LaneCause {
	lanes: Set<number>
	over_ms: number
}

function lane_causes(records: SinkRecords, issue: number): Array<LaneCause> {
	const hubs = lane_sinks
		.hubs_of(records.entries, [issue])
		.map((hub) => ({ kind: KIND.HUB, key: hub, word: path.basename(hub) }))
	const jobs = lane_why_causes
		.keys_of(records.entries, issue, undefined)
		.map((job) => ({ kind: KIND.JOB, key: job, word: job }))

	return [...hubs, ...jobs]
}

// Each cause of `issue` counted once, so a cause many lanes share stays one row.
function add_lane(
	groups: Map<string, OverCause>,
	records: SinkRecords,
	issue: number,
	threshold_ms: number,
): void {
	const over_ms = (lane_net_time.net_ms(records.entries, records.events, issue) ?? 0) - threshold_ms

	for (const cause of lane_causes(records, issue)) {
		const id = `${cause.kind}:${cause.key}`
		const group = groups.get(id) ?? { ...cause, lanes: new Set<number>(), over_ms: 0 }

		group.lanes.add(issue)
		group.over_ms += over_ms
		groups.set(id, group)
	}
}

// The causes of the lanes of `window` over `minutes`, the largest summed overrun first.
function causes_of(records: SinkRecords, window: StatsWindow, minutes: number): Array<OverCause> {
	const groups = new Map<string, OverCause>()

	for (const issue of lane_sinks.over_issues(records, window, minutes)) {
		add_lane(groups, records, issue, minutes * MS_PER_MINUTE)
	}

	return [...groups.values()].toSorted((left, right) => right.over_ms - left.over_ms)
}

function row_of(cause: OverCause, issues: ReadonlyArray<OpenIssue> | undefined): string {
	return lane_stats.to_row([
		cause.kind,
		cause.key,
		String(cause.lanes.size),
		lane_stage_stats.cell(cause.over_ms),
		lane_why_causes.open_cell([cause.word], issues),
	])
}

// The causes no open Issue names; `unread` when the listing was unreadable.
function candidates_line(
	causes: ReadonlyArray<OverCause>,
	issues: ReadonlyArray<OpenIssue> | undefined,
): string {
	if (issues === undefined) return `${CANDIDATES}${lane_sinks_issues.UNREAD}`

	const unfiled = causes
		.filter((cause) => lane_why_causes.issues_of(cause.word, issues).length === 0)
		.map((cause) => `${cause.kind} ${cause.key}`)

	return `${CANDIDATES}${unfiled.length === 0 ? lane_sinks_issues.NONE : unfiled.join(NAME_SEPARATOR)}`
}

function table(
	records: SinkRecords,
	window: StatsWindow,
	minutes: number,
	issues: ReadonlyArray<OpenIssue> | undefined,
): string {
	const causes = causes_of(records, window, minutes)

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...causes.map((cause) => row_of(cause, issues)),
		'',
		candidates_line(causes, issues),
	].join('\n')
}

// The `--over` view: the per-lane chains, then the causes they share.
function view(
	records: SinkRecords,
	window: StatsWindow,
	minutes: number,
	issues: ReadonlyArray<OpenIssue> | undefined,
): string {
	return [
		lane_over.table(records, window, minutes, issues),
		table(records, window, minutes, issues),
	].join('\n\n')
}

const lane_over_causes = { table, view }

export { lane_over_causes }
