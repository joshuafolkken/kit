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

// The issue collection — what a listing pages through and what a creation posts to. One segment,
// named once: the reads, the listing and the writes all build on it (joshuafolkken/kit#1026).
function issues_api_path(repo?: string): string {
	return `${repo_api_path(repo)}/issues`
}

function issue_api_path(issue_number: string, repo?: string): string {
	return `${issues_api_path(repo)}/${issue_number}`
}

// The dependency relations, which REST serves from their own endpoint rather than inside the issue.
// Named here because three call sites address it — the read in `git-gh-issue-read.ts` and both
// writes in `git-gh-issue-write.ts` (joshuafolkken/kit#1026).
function blocked_by_api_path(issue_number: string, repo?: string): string {
	return `${issue_api_path(issue_number, repo)}/dependencies/blocked_by`
}

const git_gh_api_path = {
	repo_api_path,
	issues_api_path,
	issue_api_path,
	blocked_by_api_path,
}

export { git_gh_api_path }
