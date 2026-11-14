import { git_gh_issue } from '#scripts/gh/git-gh-issue'
import { git_gh_issue_rest, type RestIssue } from '#scripts/gh/git-gh-issue-rest'
import { AUTO_OK_LABEL, IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { z } from 'zod'

type ListingCheck = () => Promise<boolean>

// Each listed issue's label names, joined in order: the part of an issue whose change can make it ready.
type Listing = ReadonlyMap<number, string>

const labels_schema = z.array(z.looseObject({ name: z.string() })).catch([])

function labels_of(issue: RestIssue): ReadonlyArray<string> {
	return labels_schema.parse(issue['labels']).map((label) => label.name)
}

// The `auto-ok` listing's first page, its pull requests and its `in-progress` issues left out: an
// issue at work in a lane edits its own labels, and none of those edits makes anything ready.
function listing_of(body: string): Listing {
	const issues = git_gh_issue_rest.parse_rest_issues(body)
	const listed = issues
		.filter((issue) => !git_gh_issue_rest.is_pull_request(issue))
		.map((issue) => ({ number: issue.number, labels: labels_of(issue) }))
		.filter((issue) => !issue.labels.includes(IN_PROGRESS_LABEL))

	return new Map(
		listed.map((issue) => [
			issue.number,
			issue.labels.toSorted((left, right) => left.localeCompare(right)).join(','),
		]),
	)
}

function has_change(seen: Listing | undefined, listing: Listing): boolean {
	if (seen === undefined) return false

	return [...listing].some(([number, labels]) => seen.get(number) !== labels)
}

// Whether the `auto-ok` listing's first page holds an issue the previous read lacked, or an issue whose
// labels changed since (joshuafolkken/kit#7227, joshuafolkken/kit#7507). The ETag keeps the read cheap,
// but a running lane's own comments and label edits change it too, so only a new issue, or a relabelled
// one outside a lane, counts. The first read is the baseline, and a read that fails reads as unchanged:
// the ask's interval still comes. A first read that fails leaves an empty baseline rather than none, so
// an issue listed before the next read that answers still counts as new (joshuafolkken/kit#7229).
function watcher(): ListingCheck {
	const memory: { seen?: Listing } = {}

	function keep(listing: Listing): void {
		memory.seen = listing
	}

	return async function is_changed(): Promise<boolean> {
		try {
			const detail = await git_gh_issue.issue_list_label_first_page(AUTO_OK_LABEL)
			const listing = listing_of(detail.body)
			const is_new = has_change(memory.seen, listing)

			keep(listing)

			return is_new
		} catch {
			keep(memory.seen ?? new Map())

			return false
		}
	}
}

const backlog_drive_listing = {
	watcher,
}

export type { ListingCheck }
export { backlog_drive_listing }
