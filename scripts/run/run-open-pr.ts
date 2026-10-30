import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_command } from '#scripts/git/git-command'
import { pr_info_schema } from '#scripts/git/git-schemas'
import { extract_issue_number } from '#scripts/hooks/check-commit-message'
import { json_value } from '#scripts/lib/json-value'

async function is_pending(issue: string): Promise<boolean> {
	const branch = await git_command.branch()

	if (extract_issue_number(branch) !== issue) return false

	const raw = await git_gh_command.pr_view(branch)

	return json_value.parse_with(raw, pr_info_schema)?.state === 'OPEN'
}

const run_open_pr = { is_pending }

export { run_open_pr }
