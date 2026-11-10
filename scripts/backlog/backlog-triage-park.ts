import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { issue_read, type IssueComment } from '#scripts/issue/issue-read'
import { session_cite } from '#scripts/issue/session-cite'
import { run_park_body } from '#scripts/run/park/run-park-body'

// A parked child's park as a parent reads it: the latest trusted comment that meets the park body
// schema (`run_park_body`). `backlog:triage --adopt` takes an option of it (joshuafolkken/kit#6670);
// `backlog:triage --pass` prints its recommendation, tier and `--adopt` line (joshuafolkken/kit#6777).

type ParkRead = { comments: ReadonlyArray<IssueComment>; body: string } | { problem: string }

// The latest trusted comment that meets the park body schema — what the child parked with.
function park_body(comments: ReadonlyArray<IssueComment>): string | undefined {
	return issue_read
		.trusted_bodies(comments)
		.findLast((body) => run_park_body.problem_of(body) === undefined)
}

async function read(issue: string): Promise<ParkRead> {
	const json = await git_gh_issue_read.issue_list_comments(issue)
	const comments = await issue_read.parse_comments(json)

	if (comments === undefined) return { problem: 'could not read its comments' }
	const body = park_body(comments)

	return body === undefined
		? { problem: 'no trusted comment follows the park body schema' }
		: { comments, body }
}

// An option needing the parent's own action is refused without `--done` (joshuafolkken/kit#7001).
function adopt_line(issue: string, option: number, body: string): string {
	const done = run_park_body.parent_action(body, option) ? ' --done <the parent action taken>' : ''

	return `pnpm josh backlog:triage --apply ${issue} --adopt ${String(option)} --reason <text>${done}`
}

// The park's recommendation and tier, then the `--adopt` line when a parent may take it; no line for a
// park off the schema, whose body the parent reads instead. No pick and a tier C pick stay a person's.
async function lines_of(number: number): Promise<ReadonlyArray<string>> {
	const issue = String(number)
	const park = await read(issue)

	if ('problem' in park) return []
	const summary = `${session_cite.issue(issue)} ${run_park_body.summary_of(park.body) ?? ''}`
	const pick = run_park_body.adoptable_pick(park.body)

	return pick === undefined ? [summary] : [summary, adopt_line(issue, pick, park.body)]
}

const backlog_triage_park = { lines_of, read }

export { backlog_triage_park }
