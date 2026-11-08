import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { has_any_label, PLANNED_LABEL } from '#scripts/issue/issue-labels'
import { issue_read, type IssueComment } from '#scripts/issue/issue-read'
import { markdown_section } from '#scripts/issue/markdown-section'
import { plan_consumers_section } from '#scripts/issue/plan-consumers-section'
import { lane_plan } from '#scripts/lane/lane-plan'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { backlog_overlap, type Declared } from './backlog-overlap'

// The paths a pool issue declares — the plan a running lane recorded with `lane:plan`, else the plan
// `issue:plan` posted as a comment, else its body. A plan comment posted after the record wins
// (joshuafolkken/kit#6798).
//
// **A plan replaces the body**: a body cites paths as evidence (joshuafolkken/kit#4937). A plan naming
// no path leaves the body.
//
// **A plan posted as a comment declares paths too.** joshuafolkken/kit#4910's body named none of the
// files its plan comment did, so dispatch saw no overlap with joshuafolkken/kit#4911 and
// joshuafolkken/kit#4907, and the lane sat in `lane:plan`'s `wait`
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

// A planned issue with its plan comment's posting time, which a recorded plan yields to when later
// (`lane_plan.with_plans`, joshuafolkken/kit#6798).
interface PlannedIssue extends PoolIssue {
	commented_at?: string | undefined
}

// `comment`'s plan less its consumers section — whose entries are readers, not edited files.
function plan_body(comment: IssueComment | undefined): string | undefined {
	return comment === undefined ? undefined : plan_consumers_section.without(comment.body)
}

// The latest trusted plan among `comments`, or `undefined` when none is one.
function plan_of(comments: ReadonlyArray<IssueComment>): string | undefined {
	return plan_body(comments.findLast((comment) => is_plan(comment)))
}

// The plan comment `issue` carries, or `undefined` when none does or the listing could not be read.
async function read_plan_comment(issue: number): Promise<IssueComment | undefined> {
	const json = await git_gh_issue_read.issue_list_comments(String(issue))
	const comments = await issue_read.parse_comments(json)

	return comments?.findLast((comment) => is_plan(comment))
}

async function read_plan(issue: number): Promise<string | undefined> {
	return plan_body(await read_plan_comment(issue))
}

// The paths `issue`'s plan comment declares — what `lane:plan` is handed before the first edit.
async function plan_paths(issue: number): Promise<ReadonlyArray<string>> {
	return [...backlog_overlap.declared_paths((await read_plan(issue)) ?? '')]
}

async function with_plan(issue: PoolIssue): Promise<PlannedIssue> {
	if (!has_any_label(issue.labels, PLANNED)) return issue

	const comment = await read_plan_comment(issue.number)
	const plan = plan_body(comment)

	if (plan === undefined || backlog_overlap.declared_paths(plan).size === 0) return issue

	return { ...issue, body: plan, commented_at: comment?.created_at }
}

function commented_of(planned: ReadonlyArray<PlannedIssue>): ReadonlyMap<number, string> {
	const dated = planned.filter((issue) => issue.commented_at !== undefined)

	return new Map(dated.map((issue): [number, string] => [issue.number, issue.commented_at ?? '']))
}

// What each of `issues` declares, read from `directory`'s lane plans — the scope dispatch gates on.
async function declared_of(issues: ReadonlyArray<PoolIssue>, directory: string): Promise<Declared> {
	const planned = await bounded_pool.bounded_map(issues, READ_CONCURRENCY, with_plan)
	const declared = backlog_overlap.declared_of(planned)

	return lane_plan.with_plans(declared, directory, commented_of(planned))
}

const backlog_plan_comment = { declared_of, plan_of, plan_paths, read_plan }

export { backlog_plan_comment }
export type { PoolIssue }
