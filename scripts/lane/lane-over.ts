import { session_cite } from '#scripts/issue/session-cite'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import type { LedgerEntry } from './lane-ledger'
import { lane_ledger_kind } from './lane-ledger-kind'
import { lane_net_time } from './lane-net-time'
import { lane_sinks, type SinkRecords } from './lane-sinks'
import { lane_sinks_issues, type OpenIssue } from './lane-sinks-issues'
import { lane_stage_stats } from './lane-stage-stats'
import { lane_stats, type StatsWindow } from './lane-stats'
import { lane_yield_split, type IssueYield } from './lane-yield-split'

// `josh lane:stats --over` (joshuafolkken/kit#5988): one row per lane of the period over a threshold,
// its net and waited minutes beside the ledger chain that explains it — the split notices and filed
// children, a blocking round 1, the unplanned notices, each yield with its holder and redispatch gap,
// and the hub that put `test:related` past its cap. The open Issues are matched against the lane's
// longest stage, as `--sinks` matches each of its rows.

const COLUMNS = ['lane', 'net min', 'wait min', 'chain', 'top stage', 'open issues']
const SEPARATOR = ' · '
const NO_CHAIN = '-'
const GAP_OPEN = 'gap open'
const DISPATCHED_FIRST = 'dispatched before holder end'
const { KIND } = lane_ledger_kind

type Kind = LedgerEntry['kind']
type EntryOf<K extends Kind> = Extract<LedgerEntry, { kind: K }>
type ChainPart = (records: SinkRecords, issue: number) => Array<string>

function of_kind<K extends Kind>(
	entries: ReadonlyArray<LedgerEntry>,
	kind: K,
	issue: number,
): Array<EntryOf<K>> {
	return entries.filter(
		(entry): entry is EntryOf<K> =>
			entry.kind === kind && 'issue' in entry && entry.issue === issue,
	)
}

function counted(label: string, count: number): Array<string> {
	return count === 0 ? [] : [`${label} ×${String(count)}`]
}

function split_part({ entries }: SinkRecords, issue: number): Array<string> {
	const children = of_kind(entries, KIND.SPLIT_FILED, issue).map((entry) => entry.child)
	const filed = children.length === 0 ? [] : [`${KIND.SPLIT_FILED} ${children.join(', ')}`]
	const notices = of_kind(entries, KIND.SPLIT_NOTICE, issue).length

	return [...counted(KIND.SPLIT_NOTICE, notices), ...filed]
}

function round_part({ entries }: SinkRecords, issue: number): Array<string> {
	const rounds = of_kind(entries, KIND.ROUND_ONE, issue)

	return rounds.some((round) => round.verdict === 'blocking') ? ['round 1 blocking'] : []
}

function unplanned_part({ entries }: SinkRecords, issue: number): Array<string> {
	return counted(KIND.UNPLANNED_NOTICE, of_kind(entries, KIND.UNPLANNED_NOTICE, issue).length)
}

function gap_text({ gap_ms, is_early }: IssueYield): string {
	if (gap_ms !== undefined) return `gap ${String(Math.round(gap_ms / MS_PER_MINUTE))} min`

	return is_early ? DISPATCHED_FIRST : GAP_OPEN
}

function yield_text(taken: IssueYield): string {
	const { holder } = taken
	const target = holder === undefined ? 'yield' : `yield → ${session_cite.issue(holder)}`

	return `${target} ${gap_text(taken)}`
}

function yield_part({ entries, events }: SinkRecords, issue: number): Array<string> {
	return lane_yield_split.of_issue(entries, events, issue).map((taken) => yield_text(taken))
}

function hub_part({ entries }: SinkRecords, issue: number): Array<string> {
	return lane_sinks.hubs_of(entries, [issue]).map((hub) => `hub over cap ${hub}`)
}

const CHAIN_PARTS: ReadonlyArray<ChainPart> = [
	split_part,
	round_part,
	unplanned_part,
	yield_part,
	hub_part,
]

// The lane's ledger chain in one cell, `-` when nothing in it explains the time.
function chain_of(records: SinkRecords, issue: number): string {
	const parts = CHAIN_PARTS.flatMap((part) => part(records, issue))

	return parts.length === 0 ? NO_CHAIN : parts.join(SEPARATOR)
}

// The lane's dispatch-to-merge time its net time leaves out.
function wait_ms(records: SinkRecords, issue: number, net_ms: number): number | undefined {
	const span = lane_net_time.span_of(records.entries, issue)

	return span === undefined ? undefined : span.to_ms - span.from_ms - net_ms
}

function net_of(records: SinkRecords, issue: number): number {
	return lane_net_time.net_ms(records.entries, records.events, issue) ?? 0
}

function lane_row(
	records: SinkRecords,
	issue: number,
	issues: ReadonlyArray<OpenIssue> | undefined,
): string {
	const net_ms = net_of(records, issue)
	const [top] = lane_sinks.sinks_of(records, [issue])
	const stage = top?.name ?? NO_CHAIN

	return lane_stats.to_row([
		session_cite.issue(issue),
		lane_stage_stats.cell(net_ms),
		lane_stage_stats.cell(wait_ms(records, issue, net_ms)),
		chain_of(records, issue),
		stage,
		top === undefined
			? lane_sinks_issues.NONE
			: lane_sinks.issues_cell(stage, issues, lane_sinks.hubs_of(records.entries, [issue])),
	])
}

// The table of the lanes of `window` over `minutes`, the longest net time first; `issues` is
// `undefined` when the open-Issue listing was unreadable.
function table(
	records: SinkRecords,
	window: StatsWindow,
	minutes: number,
	issues: ReadonlyArray<OpenIssue> | undefined,
): string {
	const lanes = lane_sinks
		.over_issues(records, window, minutes)
		.toSorted((left, right) => net_of(records, right) - net_of(records, left))

	return [
		lane_stats.to_row(COLUMNS),
		lane_stats.to_row(COLUMNS.map(() => '---')),
		...lanes.map((issue) => lane_row(records, issue, issues)),
	].join('\n')
}

const lane_over = { chain_of, table }

export { lane_over }
