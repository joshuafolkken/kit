import { git_gh_issue } from '#scripts/gh/git-gh-issue'
import { git_gh_issue_rest } from '#scripts/gh/git-gh-issue-rest'
import { AUTO_OK_LABEL } from '#scripts/issue/issue-labels'

type ListingCheck = () => Promise<boolean>

// The issue numbers the `auto-ok` listing's first page holds, its pull requests left out.
function numbers_of(body: string): ReadonlySet<number> {
	const issues = git_gh_issue_rest.parse_rest_issues(body)

	return new Set(
		issues
			.filter((issue) => !git_gh_issue_rest.is_pull_request(issue))
			.map((issue) => issue.number),
	)
}

function has_new(seen: ReadonlySet<number> | undefined, numbers: ReadonlySet<number>): boolean {
	if (seen === undefined) return false

	return [...numbers].some((number) => !seen.has(number))
}

// Whether the `auto-ok` listing's first page holds an issue the previous read lacked
// (joshuafolkken/kit#7227). The ETag keeps the read cheap, but a running lane's own comments and
// label edits change it too, so only a new issue number counts. The first read is the baseline,
// and a read that fails reads as unchanged: the ask's interval still comes.
function watcher(): ListingCheck {
	const memory: { seen?: ReadonlySet<number> } = {}

	return async function is_changed(): Promise<boolean> {
		try {
			const detail = await git_gh_issue.issue_list_label_first_page(AUTO_OK_LABEL)
			const numbers = numbers_of(detail.body)
			const is_new = has_new(memory.seen, numbers)

			memory.seen = numbers

			return is_new
		} catch {
			return false
		}
	}
}

const backlog_drive_listing = {
	watcher,
}

export { backlog_drive_listing }
