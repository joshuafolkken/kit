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

// A pull request's *conversation* comments. REST serves them from the issue endpoint rather than the
// pull one — `pulls/{N}/comments` is the review thread, which is a different listing with a
// different shape, and reading one where the other was meant is a silent mistake rather than a 404
// (joshuafolkken/kit#1027).
function issue_comments_api_path(issue_number: string, repo?: string): string {
	return `${issue_api_path(issue_number, repo)}/comments`
}

// The pull request collection — what a branch lookup filters with `?head=<owner>:<branch>`.
function pulls_api_path(repo?: string): string {
	return `${repo_api_path(repo)}/pulls`
}

// One pull request, addressed by number. `gh pr view` accepted a branch name and REST does not, so
// every read below the branch lookup names the number instead (joshuafolkken/kit#1027).
function pull_api_path(pr_number: string, repo?: string): string {
	return `${pulls_api_path(repo)}/${pr_number}`
}

// The review thread — the line comments a reviewer left on the diff, which is what the CodeRabbit
// gate reads and is not the same listing as `issue_comments_api_path`.
function pull_comments_api_path(pr_number: string, repo?: string): string {
	return `${pull_api_path(pr_number, repo)}/comments`
}

const git_gh_api_path = {
	repo_api_path,
	issues_api_path,
	issue_api_path,
	blocked_by_api_path,
	issue_comments_api_path,
	pulls_api_path,
	pull_api_path,
	pull_comments_api_path,
}

export { git_gh_api_path }
