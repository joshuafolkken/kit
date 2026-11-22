import { backlog_pool } from '#scripts/backlog/backlog-pool'
import { epic_rank } from '#scripts/epic/epic-rank'
import { git_gh_issue_graphql, type GraphqlIssueFields } from '#scripts/gh/git-gh-issue-graphql'
import { git_gh_issue_rest } from '#scripts/gh/git-gh-issue-rest'
import { open_issue_schema, type OpenIssueData } from '#scripts/git/git-schemas'
import type { PinnedIssue } from './run-board-pinned-graphql'

// The watch panel's rows (joshuafolkken/kit#8631): the pinned issues, then the open
// `priority:critical` ones, then the open `priority:high` ones, the first `WATCH_LIMIT` of them.
// Within a priority the order is `backlog:next`'s own (`epic_rank.rank`), never a second ranking; an
// issue already shown — pinned and critical, or critical and high — is shown once, at its first place.

const WATCH_LIMIT = 3

// The fields `backlog_pool.to_child` reads, under the names the listing gives them.
const RANK_FIELDS = [
	'number',
	'title',
	'labels',
	'createdAt',
	'blockedBy',
	'body',
	'author_association',
	'user',
]

// The GraphQL node in the listing's shape, through the listing's own mapping.
function open_issue_of(node: GraphqlIssueFields): OpenIssueData | undefined {
	const rest = git_gh_issue_graphql.to_rest_issue(node)
	const blocked_by = git_gh_issue_graphql.to_blocked_by(node)

	return open_issue_schema.safeParse(git_gh_issue_rest.to_gh_issue(rest, RANK_FIELDS, blocked_by))
		.data
}

function ranked_numbers(tier: ReadonlyArray<GraphqlIssueFields>, repo: string): Array<number> {
	const children = tier
		.map((node) => open_issue_of(node))
		.filter((issue) => issue !== undefined)
		.map((issue) => backlog_pool.to_child(issue, repo))

	return epic_rank.rank(children, children).map((child) => child.number)
}

function open_row(number: number): PinnedIssue {
	return { number, is_closed: false, closed_ms: undefined }
}

// `tiers` in the panel's order — critical, then high.
function watch_rows(
	pins: ReadonlyArray<PinnedIssue>,
	tiers: ReadonlyArray<ReadonlyArray<GraphqlIssueFields>>,
	repo: string,
): Array<PinnedIssue> {
	const shown = new Set(pins.map((pin) => pin.number))
	const ranked = tiers.flatMap((tier) => ranked_numbers(tier, repo))
	const rest = ranked.filter(
		(number, index) => !shown.has(number) && ranked.indexOf(number) === index,
	)

	return [...pins, ...rest.map((number) => open_row(number))].slice(0, WATCH_LIMIT)
}

const run_board_watch_rank = { WATCH_LIMIT, watch_rows }

export { run_board_watch_rank }
