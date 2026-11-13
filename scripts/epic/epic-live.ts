import type { EpicChild, IssueReference } from '#scripts/epic/epic-graph'
import { epic_issue } from '#scripts/epic/epic-issue'
import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_etag_read } from '#scripts/gh/git-gh-etag-read'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_gh_issue_rest } from '#scripts/gh/git-gh-issue-rest'
import { session_cite } from '#scripts/issue/session-cite'

// Each read revalidates remotely; neither the process memo nor the dependency summary answers it.
async function child(number: number, repo: string): Promise<EpicChild> {
	const json = await git_gh_issue_read.issue_view_json(
		String(number),
		'number,state,labels,body',
		repo,
		git_gh_etag_read.read,
	)
	const parsed = epic_issue.parse_epic_issue(json)

	if (parsed?.number !== number || !['OPEN', 'CLOSED'].includes(parsed.state)) {
		throw new Error(`Cannot read live issue ${session_cite.issue(number, undefined, repo)}`)
	}

	return {
		number,
		repo,
		state: epic_issue.normalize_state(parsed.state),
		labels: epic_issue.label_names(parsed),
		body: parsed.body,
		blocked_by: [],
	}
}

async function blockers(number: number, repo: string): Promise<Array<IssueReference>> {
	const endpoint = git_gh_api_path.blocked_by_api_path(String(number), repo)
	const json = await git_gh_etag_read.read_listing(
		`${endpoint}${git_gh_api_path.FULL_PAGE_QUERY}`,
		git_gh_api_path.FULL_PAGE_SIZE,
	)
	const listing = git_gh_issue_rest.to_blocked_by(json)

	return listing.nodes.map((blocker) => git_gh_issue_rest.reference_of_blocker(blocker, repo))
}

const epic_live = { child, blockers }

export { epic_live }
