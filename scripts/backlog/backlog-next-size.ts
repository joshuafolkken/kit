import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { epic_index } from '#scripts/epic/epic-index'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'
import { size_estimate } from '#scripts/issue/size-estimate'
import type { ImplementRate } from '#scripts/lane/lane-implement-rate'
import type { SizeRatios } from '#scripts/lane/lane-size-stats'
import { split_assess, type SizeMeasurement } from '#scripts/split/split-assess'
import type { PoolContext } from './backlog-gate-scope'
import { backlog_pool } from './backlog-pool'

// An offered Issue whose declared estimate is over the split guide, with no reason it stays one —
// judged by the same `size_estimate.over_guide` `issue:file` refuses on (and, reason or not, its
// `over_budget` at the pool's measured rate — joshuafolkken/kit#6066), so a body edited past the
// guide after filing is still seen before a lane starts it (joshuafolkken/kit#5384). A split child
// passes the guide at filing, yet is warned on here too: lanes land past the doubled declaration
// (joshuafolkken/kit#5935).
//
// One over the cap with no declared reason is not offered at all: it waits on a person to split it or
// declare it one deliverable (joshuafolkken/kit#5502, joshuafolkken/kit#6602). `size_estimate.over_cap`
// is the filing's own bar.

// What the note asks of the issue: a further split for a split child, else the reason it stays one.
function remedy_of(route: string | undefined): string {
	return route === SPLIT_ROUTE_LABEL
		? `on a \`${SPLIT_ROUTE_LABEL}\` child — split it further`
		: `with no \`${split_assess.REASON_PREFIX}\``
}

// An estimate projected over the implement budget (joshuafolkken/kit#6066); a declared reason excuses
// it, as it does the cap (joshuafolkken/kit#6602).
const BUDGET_REMEDY = `and is projected over the implement budget with no \`${split_assess.REASON_PREFIX}\``

interface Warning {
	estimate: SizeMeasurement
	remedy: string
}

function warning_of(
	body: string,
	route: string | undefined,
	rate: ImplementRate | undefined,
	growth?: SizeRatios,
): Warning | undefined {
	const guide =
		size_estimate.over_guide(body, route, rate, growth) ??
		size_estimate.split_over_guide(body, route, rate, growth)

	if (guide !== undefined) return { estimate: guide, remedy: remedy_of(route) }
	const budget = size_estimate.over_budget(body, rate, growth)

	return budget === undefined ? undefined : { estimate: budget, remedy: BUDGET_REMEDY }
}

function note_of(issue: OpenIssueData, context: PoolContext): string | undefined {
	const labels = issue.labels?.map((label) => label.name) ?? []
	const route = size_estimate.route_of(labels)
	const warning = warning_of(issue.body ?? '', route, context.implement_rate, context.growth)

	if (warning === undefined) return undefined
	const cited = session_cite.issue(issue.number, undefined, context.repo)

	return `${cited} ${size_estimate.exceeded(warning.estimate, context.implement_rate, context.growth)} ${warning.remedy} — split-assessment.md → "${split_assess.QUESTION_SECTION}"`
}

// One stderr line per offered number over the guide; the stdout tokens stay bare numbers.
function warn_over_guide(tokens: ReadonlyArray<string>, context: PoolContext): void {
	const offered = new Set(tokens)
	const issues = context.opted_in.issues.filter((issue) => offered.has(String(issue.number)))

	for (const issue of issues) {
		const note = note_of(issue, context)

		if (note !== undefined) console.error(note)
	}
}

// A row as the cap reads it — a standalone issue and an epic child alike.
interface CapRow {
	number: number
	repo: string
	body?: string | undefined
	labels: ReadonlyArray<string>
}

function capped_of(
	row: Pick<CapRow, 'body' | 'labels'>,
	rate?: ImplementRate,
	growth?: SizeRatios,
): SizeMeasurement | undefined {
	return size_estimate.over_cap(row.body ?? '', size_estimate.route_of(row.labels), rate, growth)
}

// The withheld note: the counts against the cap and what a person does about it.
function warn_capped(row: CapRow, rate?: ImplementRate, growth?: SizeRatios): void {
	const estimate = capped_of(row, rate, growth)

	if (estimate === undefined) return
	const cited = session_cite.issue(row.number, undefined, row.repo)

	console.error(
		`${cited} not offered: ${size_estimate.capped(estimate, rate, growth)} — split it; split-assessment.md → "${split_assess.QUESTION_SECTION}"`,
	)
}

// One stderr line per row the standalone half considers held over the cap. A row an opted-in epic
// tracks is left to `held_children`, so it is not reported twice.
function warn_over_cap(context: PoolContext): void {
	const { issues } = context.opted_in
	const considered = backlog_pool.standalone_keys(issues, {
		tracked: epic_index.withheld_children(context.tracking.index, issues),
		exclude: context.exclude,
		repo: context.repo,
	})
	const rows = backlog_pool.to_children(issues, context.repo)

	for (const row of rows) {
		if (considered.has(epic_graph.key_of(row))) {
			warn_capped(row, context.implement_rate, context.growth)
		}
	}
}

// The keys of the open epic children over the cap, each reported on stderr — held for a person the
// way an untrusted author's child is.
function held_children(
	children: ReadonlyArray<EpicChild>,
	rate?: ImplementRate,
	growth?: SizeRatios,
): ReadonlySet<string> {
	const held = children.filter(
		(child) => child.state === 'OPEN' && capped_of(child, rate, growth) !== undefined,
	)

	for (const child of held) warn_capped(child, rate, growth)

	return new Set(held.map((child) => epic_graph.key_of(child)))
}

const backlog_next_size = { held_children, warn_over_cap, warn_over_guide }

export { backlog_next_size }
