import { git_gh_issue_list, type IssueListOutcome } from './git-gh-issue-list'
import { git_gh_issue_read } from './git-gh-issue-read'
import { git_gh_issue_write } from './git-gh-issue-write'

const NUMBER_AND_BODY_FIELDS = 'number,body'
// The backlog scan's fields. The title rides along because the pre-filing scan compares titles
// (joshuafolkken/kit#1252) and it costs nothing: the same listing request already carries it, so the
// two consumers share one read rather than each making their own.
const NUMBER_TITLE_AND_BODY_FIELDS = 'number,title,body'
// The fields every listing that is *ranked* asks for: `createdAt` to order by and `labels` to
// exclude by. Shared by the next-issues display and the `auto-ok` pickup, which rank identically.
const SUMMARY_FIELDS = 'number,title,labels,createdAt'
// The pickup's list, which is the display's plus the native blocker relation. Kept apart from
// `SUMMARY_FIELDS` on purpose: a listing carries no `blockedBy`, so the field is answered from each
// row's own dependencies endpoint, and asking for it on the shared list would put that request
// behind the next-issues display too — where a refused one becomes a failure with no message at all,
// since the listing swallows the error (joshuafolkken/kit#996, joshuafolkken/kit#1025).
const PICKUP_FIELDS = `${SUMMARY_FIELDS},blockedBy`

// Every listing below goes through the one REST invocation in `git-gh-issue-list.ts`. It kept the
// `json_fields` / `limit` contract it had as a `gh issue list` wrapper, so these six callers changed
// only where a `gh` flag became a query parameter (joshuafolkken/kit#1025).
//
// **All six answer `IssueListOutcome`, not the JSON alone** (joshuafolkken/kit#1067). The page
// ceiling now bounds every one of them, and a bound whose caller cannot see it was reached is a
// silently shortened answer — so the flag rides out to the caller and the caller decides. The
// disposition each one settled on, and why:
//
// | Caller | Truncation is | Why |
// | --- | --- | --- |
// | `issue_list_recent` | **ignorable** | The display shows the five newest of the twenty it asks for, and the paging is newest-first — so a truncated read is a *prefix* of the untruncated one and the five rows are the same five. Nothing is hidden that this display would have shown. |
// | `issue_list_open_bodies` | **warning** | `epic:bundle` scanned what it scanned; a related issue past the cut is missed, which is what its existing `⚠ … cap` line already says. The scan ran, so it is something to read rather than a check that did not happen. |
// | `issue_search_body` | **warning** | Unchanged from joshuafolkken/kit#1033 — the orphan search ran over the newest issues, and an orphan is normally an issue filed minutes ago. |
// | `issue_list_by_label` | **warning** | Both consumers report it: `epic:bundle`'s epic listing, where an epic past the cut has its child recommended a second epic, and the auto-close, where an epic past the cut is never checked for completion. Neither may fail — the auto-close runs after the merge — so both print and continue. |
// | `issue_list_by_label_summary` | **warning** | The `auto-ok` pickup already says the cap dropped the *oldest* opted-in issues; the ceiling drops the same ones. The answer it gives is still opted in, just possibly not the highest-priority one. |
// | `issue_list_by_label_in_repo` | **error** | `epic:busy` asks whether a repository already has work running in it, and it is the only one of the six whose answer *authorizes an action*. A truncated listing with no visible holder is not "nothing is running", and reading it as one starts a second run in the same checkout — the direction joshuafolkken/kit#925 closed. It lands with the unreadable listing, on `wait`. It is also the only caller that reports the page ceiling **without** the `limit` cap beside it; `epic-busy.ts` records why a full page of parked issues must not latch the guard. |
//
// The split is joshuafolkken/kit#1033's, applied caller by caller rather than copied: truncation is
// a warning where the scan *ran* and an error where the answer it produced would authorize an
// action. Only `epic:busy` authorizes one.
const { issue_list_open } = git_gh_issue_list

// The newest open issues, for the next-issues display at workflow completion (#821). `createdAt`
// rides along because the caller re-sorts explicitly rather than inheriting the listing's order.
async function issue_list_recent(limit: number): Promise<IssueListOutcome> {
	return await issue_list_open({ json_fields: SUMMARY_FIELDS, limit })
}

// Every open issue with its title and body. Used by `epic:bundle` to scan the backlog and by
// `issue:scout` to compare titles before one is filed; a search with an empty term is not a listing,
// and asking `gh` for one produced a partial and arbitrary answer (joshuafolkken/kit#873).
async function issue_list_open_bodies(limit: number): Promise<IssueListOutcome> {
	return await issue_list_open({ json_fields: NUMBER_TITLE_AND_BODY_FIELDS, limit })
}

// Open issues whose body mentions `term`. Used by `epic:audit` to find an issue that names an epic
// as its parent while the epic's task list does not track it (joshuafolkken/kit#870).
//
// The one listing here whose filter runs client-side, and so the one that reaches the page ceiling
// on an ordinary repository: its matches are normally zero, so "stop once `limit` rows are selected"
// never fires for it (joshuafolkken/kit#1033).
async function issue_search_body(term: string, limit: number): Promise<IssueListOutcome> {
	return await issue_list_open({
		json_fields: NUMBER_AND_BODY_FIELDS,
		limit,
		body_term: term,
	})
}

async function issue_list_by_label(label: string, limit: number): Promise<IssueListOutcome> {
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
): Promise<IssueListOutcome> {
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
): Promise<IssueListOutcome> {
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
