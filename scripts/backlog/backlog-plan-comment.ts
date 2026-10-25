import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { has_any_label, PLANNED_LABEL } from '#scripts/issue/issue-labels'
import { issue_read, type IssueComment } from '#scripts/issue/issue-read'
import { markdown_section } from '#scripts/issue/markdown-section'
import { plan_consumers_section } from '#scripts/issue/plan-consumers-section'
import { lane_plan } from '#scripts/lane/lane-plan'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { backlog_overlap, type Declared } from './backlog-overlap'

// The paths a pool issue declares — its body, the plan `issue:plan` posted as a comment, and the plan a
// running lane recorded with `lane:plan`.
//
// **A plan posted as a comment declares paths too.** joshuafolkken/kit#4910's body named none of the
// files its plan comment did, so dispatch saw no overlap with joshuafolkken/kit#4911 and
// joshuafolkken/kit#4907, and the lane sat in `lane:plan`'s `wait` for 23 minutes
// (joshuafolkken/kit#4923). Only a `run:planned` issue is read, so an unplanned pool costs no request,
// and only a trusted author's comment counts — the same trust `issue:read` applies. A plan is the
// comment carrying the consumers section `issue:plan` refuses a plan without; the latest one wins.
// A listing that cannot be read leaves the body alone — the scope dispatch gated on before — and
// `lane:plan` still holds the lane at its first edit.

const PLANNED: ReadonlySet<string> = new Set([PLANNED_LABEL])
const READ_CONCURRENCY = 8

interface PoolIssue {
	number: number
	body?: string | undefined
	labels?: ReadonlyArray<{ name: string }> | undefined
}

function is_plan(comment: IssueComment): boolean {
	return (
		comment.is_trusted === true &&
		markdown_section.has_line(comment.body, plan_consumers_section.HEADING)
	)
}

// The latest trusted plan among `comments`, less its consumers section — whose entries are readers,
// not edited files — or `undefined` when none is one.
function plan_of(comments: ReadonlyArray<IssueComment>): string | undefined {
	const plan = comments.findLast((comment) => is_plan(comment))?.body

	return plan === undefined ? undefined : plan_consumers_section.without(plan)
}

// The plan comment `issue` carries, or `undefined` when none does or the listing could not be read.
async function read_plan(issue: number): Promise<string | undefined> {
	const json = await git_gh_issue_read.issue_list_comments(String(issue))
	const comments = await issue_read.parse_comments(json)

	return comments === undefined ? undefined : plan_of(comments)
}

// The paths `issue`'s plan comment declares — what `lane:plan` is handed before the first edit.
async function plan_paths(issue: number): Promise<ReadonlyArray<string>> {
	return [...backlog_overlap.declared_paths((await read_plan(issue)) ?? '')]
}

async function with_plan(issue: PoolIssue): Promise<PoolIssue> {
	if (!has_any_label(issue.labels, PLANNED)) return issue

	const plan = await read_plan(issue.number)

	return plan === undefined ? issue : { ...issue, body: `${issue.body ?? ''}\n${plan}` }
}

// What each of `issues` declares, read from `directory`'s lane plans — the scope dispatch gates on.
async function declared_of(issues: ReadonlyArray<PoolIssue>, directory: string): Promise<Declared> {
	const planned = await bounded_pool.bounded_map(issues, READ_CONCURRENCY, with_plan)

	return lane_plan.with_plans(backlog_overlap.declared_of(planned), directory)
}

const backlog_plan_comment = { declared_of, plan_of, plan_paths }

export { backlog_plan_comment }
