import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_rest } from '#scripts/gh/git-gh-issue-rest'
import { issue_closing_pr } from './issue-closing-pr'
import { issue_sample_gate } from './issue-sample-gate'
import { session_cite } from './session-cite'

// joshuafolkken/kit#4460: the start condition cites the pull request whose merge it waits on. An issue
// number passes the format check, then reads as a pull request that is never found, so the issue waits
// forever. The filing reads what the number names and refuses an issue, citing the merged pull request
// that closed it when there is one. An unreadable number passes — an outage is no reason to stop.
//
// `repo` is the filing's target, `undefined` for this checkout. The closing pull request is looked up
// only here: `issue_closing_pr` reads this checkout's timeline, so a foreign target gets the plain hint.

interface SourcePorts {
	is_pull: (number: number, repo: string | undefined) => Promise<boolean | undefined>
	closing_pr: (issue: number) => Promise<number | undefined>
}

async function read_is_pull(
	number: number,
	repo: string | undefined,
): Promise<boolean | undefined> {
	try {
		const json = await git_gh_exec.exec_gh_api({
			path: git_gh_api_path.issue_api_path(String(number), repo),
		})

		return git_gh_issue_rest.is_pull_request(git_gh_issue_rest.parse_rest_issue(json))
	} catch {
		return undefined
	}
}

async function read_closing_number(issue: number): Promise<number | undefined> {
	return await issue_closing_pr.read_closing_number(issue)
}

const DEFAULT_PORTS: SourcePorts = { is_pull: read_is_pull, closing_pr: read_closing_number }

// No merged closing pull request yet — the lane filing ahead of its own (joshuafolkken/kit#5051) —
// points at the form that waits on the pull request to come.
async function hint_of(
	issue: number,
	repo: string | undefined,
	ports: SourcePorts,
): Promise<string> {
	const closing = repo === undefined ? await ports.closing_pr(issue) : undefined

	if (closing === undefined) {
		return `cite the pull request whose merge it waits on, or write \`${issue_sample_gate.CLOSING_FORMAT}\` to wait on the one that closes it`
	}

	return `cite the pull request that closed it: ${session_cite.issue(closing)}`
}

// The refusal for a pull request condition citing an issue, or `undefined` when it cites a pull
// request, cites nothing, uses the issue form, or cannot be read.
async function problem(
	body: string,
	repo?: string,
	ports: SourcePorts = DEFAULT_PORTS,
): Promise<string | undefined> {
	const number = issue_sample_gate.cited_via(body, 'pull')

	if (number === undefined || (await ports.is_pull(number, repo)) !== false) return undefined
	const cited = session_cite.issue(number, undefined, repo)
	const hint = await hint_of(number, repo, ports)

	return `\`- 実施可能条件:\` cites ${cited}, an issue, not a pull request — ${hint}`
}

const issue_sample_source = { problem }

export type { SourcePorts }
export { issue_sample_source }
