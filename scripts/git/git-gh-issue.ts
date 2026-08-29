import { git_gh_issue_list } from './git-gh-issue-list'
import { git_gh_issue_read } from './git-gh-issue-read'
import { git_gh_issue_write } from './git-gh-issue-write'

const NUMBER_AND_BODY_FIELDS = 'number,body'
// The fields every listing that is *ranked* asks for: `createdAt` to order by and `labels` to
// exclude by. Shared by the next-issues display and the `auto-ok` pickup, which rank identically.
const SUMMARY_FIELDS = 'number,title,labels,createdAt'
// The pickup's list, which is the display's plus the native blocker relation. Kept apart from
// `SUMMARY_FIELDS` on purpose: a listing carries no `blockedBy`, so the field is answered from each
// row's own dependencies endpoint, and asking for it on the shared list would put that request
// behind the next-issues display too — where a refused one becomes a failure with no message at all,
// since `issue_list_open` swallows the error (joshuafolkken/kit#996, joshuafolkken/kit#1025).
const PICKUP_FIELDS = `${SUMMARY_FIELDS},blockedBy`

// Every listing below goes through the one REST invocation in `git-gh-issue-list.ts`. It kept the
// name and the `json_fields` / `limit` contract it had as a `gh issue list` wrapper, so these six
// callers changed only where a `gh` flag became a query parameter (joshuafolkken/kit#1025).
const { issue_list_open } = git_gh_issue_list

// The newest open issues, for the next-issues display at workflow completion (#821). `createdAt`
// rides along because the caller re-sorts explicitly rather than inheriting the listing's order.
async function issue_list_recent(limit: number): Promise<string | undefined> {
	return await issue_list_open({ json_fields: SUMMARY_FIELDS, limit })
}

// Every open issue with its body. Used by `epic:bundle` to scan the backlog; a search with an empty
// term is not a listing, and asking `gh` for one produced a partial and arbitrary answer
// (joshuafolkken/kit#873).
async function issue_list_open_bodies(limit: number): Promise<string | undefined> {
	return await issue_list_open({ json_fields: NUMBER_AND_BODY_FIELDS, limit })
}

// Open issues whose body mentions `term`. Used by `epic:audit` to find an issue that names an epic
// as its parent while the epic's task list does not track it (joshuafolkken/kit#870).
async function issue_search_body(term: string, limit: number): Promise<string | undefined> {
	return await issue_list_open({ json_fields: NUMBER_AND_BODY_FIELDS, limit, body_term: term })
}

async function issue_list_by_label(label: string, limit: number): Promise<string | undefined> {
	return await issue_list_open({ json_fields: NUMBER_AND_BODY_FIELDS, limit, label })
}

// The same filter with the fields the `auto-ok` pickup needs (joshuafolkken/kit#906): it orders by
// `createdAt` and re-checks `labels` client-side, so bodies would be fetched and thrown away. A
// label that does not exist in the repository is not an error — the listing comes back empty, which
// is exactly "nobody has opted anything in".
// `json_fields` overrides the pickup's list. Its only caller is the probe that runs *after* a failed
// read, asking the same question without `blockedBy` so a refused dependencies endpoint is told
// apart from an access failure (joshuafolkken/kit#1005).
async function issue_list_by_label_summary(
	label: string,
	limit: number,
	options?: { json_fields?: string },
): Promise<string | undefined> {
	return await issue_list_open({
		json_fields: options?.json_fields ?? PICKUP_FIELDS,
		limit,
		label,
	})
}

// Open issues carrying `label` in one named repository — the read `epic:next` makes before it
// offers a child, to see whether that repository already has one running (joshuafolkken/kit#925).
//
// `SUMMARY_FIELDS` rather than `PICKUP_FIELDS`: the answer is only "which issues hold this
// repository", and asking for `blockedBy` would put a dependencies request behind the guard — where
// a refused one fails the whole listing, which this caller must never read as "nothing is running".
//
// `repo` names the repository inside the REST path (`git-gh-api-path.ts`). Omitted, the listing is
// the repository the command runs in, exactly as every other listing here.
async function issue_list_by_label_in_repo(
	label: string,
	limit: number,
	repo?: string,
): Promise<string | undefined> {
	return await issue_list_open({ json_fields: SUMMARY_FIELDS, limit, label, repo })
}

const git_gh_issue = {
	...git_gh_issue_read,
	...git_gh_issue_write,
	issue_list_recent,
	issue_list_by_label,
	issue_list_by_label_in_repo,
	issue_list_by_label_summary,
	issue_search_body,
	issue_list_open_bodies,
}

export { git_gh_issue, PICKUP_FIELDS, SUMMARY_FIELDS }
