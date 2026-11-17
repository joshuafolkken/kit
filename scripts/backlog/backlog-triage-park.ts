import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { issue_read, type IssueComment } from '#scripts/issue/issue-read'
import { session_cite } from '#scripts/issue/session-cite'
import { run_park_body } from '#scripts/run/park/run-park-body'

// A parked child's park as a parent reads it: the latest trusted comment that meets the park body
// schema (`run_park_body`). `backlog:triage --adopt` takes an option of it (joshuafolkken/kit#6670);
// `backlog:triage --pass` prints its recommendation, tier and `--adopt` line (joshuafolkken/kit#6777).

type ParkRead = { comments: ReadonlyArray<IssueComment>; body: string } | { problem: string }

// The latest trusted comment that meets the park body schema's structure — what the child parked with.
function park_body(comments: ReadonlyArray<IssueComment>): string | undefined {
	return issue_read.trusted_bodies(comments).findLast((body) => run_park_body.is_park(body))
}

// The latest park, refused when its permission is off the vocabulary rather than read past to an
// older park (joshuafolkken/kit#7818).
function park_of(comments: ReadonlyArray<IssueComment>): ParkRead {
	const body = park_body(comments)

	if (body === undefined) return { problem: 'no trusted comment follows the park body schema' }
	const problem = run_park_body.problem_of(body)

	return problem === undefined ? { comments, body } : { problem: `its latest park: ${problem}` }
}

async function read(issue: string): Promise<ParkRead> {
	const json = await git_gh_issue_read.issue_list_comments(issue)
	const comments = await issue_read.parse_comments(json)

	return comments === undefined ? { problem: 'could not read its comments' } : park_of(comments)
}

// An option needing the parent's own action is refused without `--done` (joshuafolkken/kit#7001);
// a filing option's `--done` names the open Issue filed (joshuafolkken/kit#7771); a closing option
// is taken by the adopt itself, so it carries none (joshuafolkken/kit#7805).
function done_of(option: number, body: string): string {
	if (run_park_body.filing_action(body, option)) return ' --done "filed #<M>"'

	return run_park_body.done_needed(body, option) ? ' --done <the parent action taken>' : ''
}

function adopt_line(issue: string, option: number, body: string): string {
	const done = done_of(option, body)

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
