import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_graphql } from '#scripts/gh/git-gh-issue-graphql'
import { git_gh_transport } from '#scripts/gh/git-gh-transport'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// The repository's open and closed issues as `run:board`'s first line ends on them — `📮 87/6,912` —
// so the backlog's size is read off the board rather than GitHub (joshuafolkken/kit#7088). GraphQL's
// `issues` holds no pull request, which REST's `open_issues_count` counts; a REST session reads
// `search/issues` instead. Read on the board's GitHub reads (`run-board-github.ts`), never on a
// redraw; a failed read answers `undefined` and draws nothing.

const ICON = '📮'
const LOCALE = 'en-US'

interface IssueCount {
	open: number
	closed: number
}

const COUNT_QUERY = `query($owner: String!, $name: String!) {
	repository(owner: $owner, name: $name) {
		open: issues(states: OPEN) { totalCount }
		closed: issues(states: CLOSED) { totalCount }
	}
}`

const total_schema = z.object({ totalCount: z.number() })
const search_schema = z.object({ total_count: z.number() })

const answer_schema = z
	.object({
		data: z.object({ repository: z.object({ open: total_schema, closed: total_schema }) }),
	})
	.transform(({ data }): IssueCount => ({
		open: data.repository.open.totalCount,
		closed: data.repository.closed.totalCount,
	}))

function count_of(text: string | undefined): IssueCount | undefined {
	return text === undefined ? undefined : json_value.parse_with(text, answer_schema)
}

function search_path(repo: string, state: string): string {
	const parameters = new URLSearchParams({ q: `repo:${repo} is:issue is:${state}`, per_page: '1' })

	return `search/issues?${parameters.toString()}`
}

async function read_search_total(repo: string, state: string): Promise<number | undefined> {
	try {
		const raw = await git_gh_exec.exec_gh_api({ path: search_path(repo, state) })

		return json_value.parse_with(raw, search_schema)?.total_count
	} catch {
		return undefined
	}
}

// A REST session (`git_gh_transport.query` answers `undefined`) counts through `search/issues`, whose
// `is:issue` also leaves pull requests out — two requests on the search budget, not the core one.
async function read_rest_count(repo: string): Promise<IssueCount | undefined> {
	const [open, closed] = await Promise.all([
		read_search_total(repo, 'open'),
		read_search_total(repo, 'closed'),
	])

	return open === undefined || closed === undefined ? undefined : { open, closed }
}

// `repo` as `owner/repo`; a repository that cannot be spelled, or GitHub not answering, is no count.
async function read_issue_count(repo: string): Promise<IssueCount | undefined> {
	const variables = git_gh_issue_graphql.repository_variables_of(repo)

	if (variables === undefined) return undefined

	const text = await git_gh_transport.query({ query: COUNT_QUERY, variables })

	return text === undefined ? await read_rest_count(repo) : count_of(text)
}

// The chip, drawn only once the plan has named the repository and its count has been read.
function part_of(repo: string | undefined, count: IssueCount | undefined): string | undefined {
	if (repo === undefined || count === undefined) return undefined

	return `${ICON} ${count.open.toLocaleString(LOCALE)}/${count.closed.toLocaleString(LOCALE)}`
}

const run_board_issue_count = { count_of, part_of, read_issue_count }

export { run_board_issue_count }
export type { IssueCount }
