import { backlog_plan, type PlanContext } from '#scripts/backlog/backlog-plan'
import type { EpicChild } from '#scripts/epic/epic-graph'
import type { IssueReference } from '#scripts/epic/epic-reference'
import { issue_cite } from '#scripts/issue/issue-cite'
import { run_board_link } from './run-board-link'
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

// The blocker as the board names it: `7228` here, `kit#7691` for another of this owner's
// repositories, `owner/repo#N` for anyone else's (joshuafolkken/kit#7695). `run-board-link.ts` links
// the short form back to the owner.
function reference_of(edge: IssueReference, repo: string): string {
	if (edge.repo === repo) return String(edge.number)

	const owner = run_board_link.owner_of(repo)
	const is_owned = run_board_link.owner_of(edge.repo) === owner
	const named = is_owned ? edge.repo.slice(owner.length + 1) : edge.repo

	return issue_cite.plain_for('terminal', edge.number, named)
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

// A ⏳ lane row's standing blockers, which its line end draws: an upstream interrupt's wait stays a
// lane (`run-board-retry-wait.ts`) and names what it waits on (joshuafolkken/kit#7695).
function of_touched(
	number: number,
	status: ItemStatus,
	waits: ReadonlyMap<number, ReadonlyArray<string>> | undefined,
): ReadonlyArray<string> {
	return status.state === 'waiting' ? (waits?.get(number) ?? []) : []
}

// A blocker in another repository still standing — the upstream Issue an interrupt filed.
function is_upstream_held(child: EpicChild, context: PlanContext): boolean {
	return child.blocked_by.some(
		(edge) => edge.repo !== context.repo && backlog_plan.is_standing(edge, context),
	)
}

const run_board_standing_waits = {
	by_number,
	is_upstream_held,
	is_waiting_on,
	of_touched,
	waits_of,
}

export { run_board_standing_waits }
