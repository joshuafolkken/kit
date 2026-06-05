import { git_gh_exec } from './git-gh-exec'
import { git_gh_helpers } from './git-gh-helpers'

async function repo_get_name_with_owner(): Promise<string | undefined> {
	try {
		const result: string = await git_gh_exec.exec_gh_command([
			'repo',
			'view',
			'--json',
			'nameWithOwner',
			'--jq',
			'.nameWithOwner',
		])

		return git_gh_helpers.parse_pr_state_string(result)
	} catch {
		return undefined
	}
}

const git_gh_repo = {
	repo_get_name_with_owner,
}

export { git_gh_repo }
