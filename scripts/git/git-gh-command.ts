import { git_gh_issue } from './git-gh-issue'
import { git_gh_pr } from './git-gh-pr'
import { git_gh_repo } from './git-gh-repo'
import { git_pr_checks_watch } from './git-pr-checks-watch'

const git_gh_command = {
	...git_gh_pr,
	pr_checks_watch: git_pr_checks_watch.pr_checks_watch,
	...git_gh_issue,
	...git_gh_repo,
}

export { git_gh_command }
export { parse_pr_state_string } from './git-gh-helpers'
export { PR_CHECKS_WATCH_TIMEOUT_MS } from './git-pr-checks-watch'
