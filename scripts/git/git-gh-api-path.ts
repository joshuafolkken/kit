// REST path construction for `gh api`, in one place.
//
// Every repository-scoped path starts with the same segment, and the same `repo ?? '{owner}/{repo}'`
// decision was already being spelled out per call site — in `git-gh-issue-read.ts`, and as a bare
// string concatenation in `git-gh-pr.ts` and `epic-cross-repo.ts`. All three now build their paths
// from here. Converting kit's GitHub calls to REST multiplies those call sites, so the decision is
// made once rather than at each one (joshuafolkken/kit#1023).

// `gh api` expands `{owner}` and `{repo}` from the current repository, so the unqualified form needs
// no extra lookup to name a path. An explicit `repo` names another repository — the form a
// cross-repository reference takes.
function repo_api_path(repo?: string): string {
	return `repos/${repo ?? '{owner}/{repo}'}`
}

function issue_api_path(issue_number: string, repo?: string): string {
	return `${repo_api_path(repo)}/issues/${issue_number}`
}

const git_gh_api_path = {
	repo_api_path,
	issue_api_path,
}

export { git_gh_api_path }
