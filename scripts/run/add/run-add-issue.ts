import { epic_issue, type EpicIssue } from '#scripts/epic/epic-issue'
import { git_gh_command } from '#scripts/gh/git-gh-command'

// Retry decisions require every native blocker, including blockers beyond the returned page.
async function read(issue: number): Promise<EpicIssue | undefined> {
	const result = await git_gh_command.issue_get_state_and_relations_classified(String(issue))
	if (result.kind !== 'read') return undefined
	const parsed = epic_issue.parse_epic_issue(result.json)

	if (parsed === undefined) return undefined
	const relation = parsed.blockedBy
	if (relation === undefined) return undefined

	return relation.totalCount === relation.nodes.length ? parsed : undefined
}

export const run_add_issue = { read }
