import { git_gh_api_path } from './git-gh-api-path'
import { git_gh_exec } from './git-gh-exec'

const LABEL_NAMES_FILTER = '.[].name'

// An Issue's or pull request's label names, every page of them, read synchronously; a failed read
// throws, and each caller words its own failure.
function read_sync(issue_number: string, repository?: string): ReadonlyArray<string> {
	const names = git_gh_exec.exec_gh_api_sync({
		path: git_gh_api_path.issue_labels_api_path(issue_number, repository),
		should_paginate: true,
		jq_filter: LABEL_NAMES_FILTER,
	})

	return names.split('\n').filter((name) => name !== '')
}

const gh_issue_label_names = { read_sync }

export { gh_issue_label_names }
