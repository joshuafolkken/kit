import { git_gh_api_path } from './git-gh-api-path'
import { git_gh_exec } from './git-gh-exec'
import { git_gh_helpers } from './git-gh-helpers'

// `owner/repo` for the repository the session runs in.
//
// Read through REST rather than `gh repo view --json nameWithOwner`: the `gh <noun> <verb>` form
// goes through GraphQL, which a cloud session is refused outright (403), so this read answered
// `undefined` there and every caller needing the name inherited that answer
// (joshuafolkken/kit#1023).
//
// This unblocks the name itself, not yet the callers that also read something else through GraphQL:
// `pr_get_review_comments` builds a REST path from this value but still asks `gh pr view` for the
// number, so it stays blocked until that call is converted too (joshuafolkken/kit#1024).
//
// The failure contract is unchanged: `undefined` when the read fails, for a caller that has nothing
// better to do with the error than treat the name as unknown.
async function repo_get_name_with_owner(): Promise<string | undefined> {
	try {
		const result: string = await git_gh_exec.exec_gh_api({
			path: git_gh_api_path.repo_api_path(),
			jq_filter: '.full_name',
		})

		return git_gh_helpers.parse_pr_state_string(result)
	} catch {
		return undefined
	}
}

const git_gh_repo = {
	repo_get_name_with_owner,
}

export { git_gh_repo }
