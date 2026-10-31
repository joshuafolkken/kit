import { epic_graph, type EpicChild } from '#scripts/epic/epic-graph'
import { epic_index } from '#scripts/epic/epic-index'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { session_cite } from '#scripts/issue/session-cite'
import { size_estimate } from '#scripts/issue/size-estimate'
import { split_assess, type SizeMeasurement } from '#scripts/split/split-assess'
import type { PoolContext } from './backlog-gate-scope'
import { backlog_pool } from './backlog-pool'

// An offered Issue whose declared estimate is over the split guide, with no reason it stays one —
// judged by the same `size_estimate.over_guide` `issue:file` refuses on, so a body edited past the
// guide after filing is still seen before a lane starts it (joshuafolkken/kit#5384).
//
// One over the cap is not offered at all: it waits on a person to split it, whatever reason it
// declares (joshuafolkken/kit#5502). `size_estimate.over_cap` is the filing's own bar.

function note_of(issue: OpenIssueData, repo: string): string | undefined {
	const labels = issue.labels?.map((label) => label.name) ?? []
	const estimate = size_estimate.over_guide(issue.body ?? '', size_estimate.route_of(labels))

	if (estimate === undefined) return undefined
	const cited = session_cite.issue(issue.number, undefined, repo)

	return `${cited} ${size_estimate.exceeded(estimate)} with no \`${split_assess.REASON_PREFIX}\` — split-assessment.md → "${split_assess.QUESTION_SECTION}"`
}

// One stderr line per offered number over the guide; the stdout tokens stay bare numbers.
function warn_over_guide(tokens: ReadonlyArray<string>, context: PoolContext): void {
	const offered = new Set(tokens)
	const issues = context.opted_in.issues.filter((issue) => offered.has(String(issue.number)))

	for (const issue of issues) {
		const note = note_of(issue, context.repo)

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

function capped_of(row: Pick<CapRow, 'body' | 'labels'>): SizeMeasurement | undefined {
	return size_estimate.over_cap(row.body ?? '', size_estimate.route_of(row.labels))
}

// The withheld note: the counts against the cap and what a person does about it.
function warn_capped(row: CapRow): void {
	const estimate = capped_of(row)

	if (estimate === undefined) return
	const cited = session_cite.issue(row.number, undefined, row.repo)

	console.error(
		`${cited} not offered: ${size_estimate.capped(estimate)} — split it; split-assessment.md → "${split_assess.QUESTION_SECTION}"`,
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

	for (const row of rows) if (considered.has(epic_graph.key_of(row))) warn_capped(row)
}

// The keys of the open epic children over the cap, each reported on stderr — held for a person the
// way an untrusted author's child is.
function held_children(children: ReadonlyArray<EpicChild>): ReadonlySet<string> {
	const held = children.filter((child) => child.state === 'OPEN' && capped_of(child) !== undefined)

	for (const child of held) warn_capped(child)

	return new Set(held.map((child) => epic_graph.key_of(child)))
}

const backlog_next_size = { held_children, warn_over_cap, warn_over_guide }

export { backlog_next_size }
