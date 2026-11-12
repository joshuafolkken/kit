import { backlog_plan, type PlanContext } from '#scripts/backlog/backlog-plan'
import type { EpicChild } from '#scripts/epic/epic-graph'
import type { IssueReference } from '#scripts/epic/epic-reference'
import { issue_cite } from '#scripts/issue/issue-cite'
import type { ItemStatus } from './run-board-status'

// The blockers that still hold a child, as its row names them: an untouched row draws them as 🔗, and
// a stalled row — touched or not — waits on them in place of its retry.

interface WaitSource {
	plan: { context: PlanContext }
	statuses: ReadonlyMap<number, ItemStatus>
}

// A blocker the plan still names, unless the stream has already seen it merge — the plan was read up
// to two minutes ago, and a merge since then is no longer worth waiting on.
function is_waiting_on(edge: IssueReference, source: WaitSource): boolean {
	const { context } = source.plan
	const is_merged =
		edge.repo === context.repo && source.statuses.get(edge.number)?.state === 'merged'

	return !is_merged && backlog_plan.is_standing(edge, context)
}

function reference_of(edge: IssueReference, repo: string): string {
	return edge.repo === repo
		? String(edge.number)
		: issue_cite.plain_for('terminal', edge.number, edge.repo)
}

function waits_of(child: EpicChild, source: WaitSource): Array<string> {
	return child.blocked_by
		.filter((edge) => is_waiting_on(edge, source))
		.map((edge) => reference_of(edge, source.plan.context.repo))
}

// Each planned child's standing blockers, by number — what a touched row, which the plan does not
// draw, reads its own from.
function by_number(
	children: ReadonlyArray<EpicChild>,
	source: WaitSource,
): ReadonlyMap<number, ReadonlyArray<string>> {
	return new Map(children.map((child) => [child.number, waits_of(child, source)]))
}

const run_board_standing_waits = {
	by_number,
	is_waiting_on,
	waits_of,
}

export { run_board_standing_waits }
