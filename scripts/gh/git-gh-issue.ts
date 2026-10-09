import { git_gh_issue_list, type IssueListOutcome } from './git-gh-issue-list'
import { git_gh_issue_read } from './git-gh-issue-read'
import { BLOCKED_BY_COUNT_FIELD } from './git-gh-issue-rest'
import { git_gh_issue_write } from './git-gh-issue-write'

const NUMBER_AND_BODY_FIELDS = 'number,body'
// The backlog scan's fields. The title rides along because the pre-filing scan compares titles
// and it costs nothing: the same listing request already carries it, so the
// two consumers share one read rather than each making their own.
//
// `blocked_by_count` rides along for the same reason and is the one field here that `gh --json`
// never had: it is read out of the `issue_dependencies_summary` the listing response already
// carries, so it costs no request at all. It is what lets `epic:bundle`
// tell a row with no blockers from one with some **before** deciding whether that row is worth a
// per-issue read, which would otherwise be made for every open issue in the repository. Absent on a
// row whose summary is missing, which must not be read as zero; `git-gh-issue-rest.ts` states why.
const BACKLOG_SCAN_FIELDS = `number,title,body,${BLOCKED_BY_COUNT_FIELD}`
// The recently-closed scan's fields. It compares titles like the scan above
// and never reads a body, and it needs the labels to tell an epic from a deliverable — the open half
// gets that from the epic listing, which by construction holds no closed epic.
const NUMBER_TITLE_AND_LABELS_FIELDS = 'number,title,labels'
// The fields every listing that is *ranked* asks for: `createdAt` to order by and `labels` to
// exclude by. Shared by the next-issues display and the `auto-ok` pickup, which rank identically.
const SUMMARY_FIELDS = 'number,title,labels,createdAt'
// The pickup's list, which is the display's plus the native blocker relation. Kept apart from
// `SUMMARY_FIELDS` on purpose: a listing carries no `blockedBy`, so the field is answered from each
// row's own dependencies endpoint, and asking for it on the shared list would put that request
// behind the next-issues display too — where a refused one becomes a failure with no message at all,
// since the listing swallows the error. `body` costs
// no request — the REST listing row already carries it — and is what the backlog offer reads for
// the restructures each issue declares.
const PICKUP_FIELDS = `${SUMMARY_FIELDS},blockedBy,body`

// Every listing below goes through the one REST invocation in `git-gh-issue-list.ts`. It kept the
// `json_fields` / `limit` contract it had as a `gh issue list` wrapper, so these callers changed
// only where a `gh` flag became a query parameter.
//
// **They all answer `IssueListOutcome`, not the JSON alone**. The page
// ceiling now bounds every one of them, and a bound whose caller cannot see it was reached is a
// silently shortened answer — so the flag rides out to the caller and the caller decides. The
// disposition each one settled on, and why:
//
// | Caller | Truncation is | Why |
// | --- | --- | --- |
// | `issue_list_recent` | **ignorable** | The display shows the five newest of the twenty it asks for, and the paging is newest-first — so a truncated read is a *prefix* of the untruncated one and the five rows are the same five. Nothing is hidden that this display would have shown. |
// | `issue_list_open_bodies` | **warning** | `epic:bundle` scanned what it scanned; a related issue past the cut is missed, which is what its existing `⚠ … cap` line already says. The scan ran, so it is something to read rather than a check that did not happen. |
// | `issue_search_body` | **warning** | The orphan search runs over the newest issues, and an orphan is normally an issue filed minutes ago. |
// | `issue_list_by_label` | **warning** | Both consumers report it: `epic:bundle`'s epic listing, where an epic past the cut has its child recommended a second epic, and the auto-close, where an epic past the cut is never checked for completion. Neither may fail — the auto-close runs after the merge — so both print and continue. |
// | `issue_list_by_label_summary` | **warning** | The `auto-ok` pickup already says the cap dropped the *oldest* opted-in issues; the ceiling drops the same ones. The answer it gives is still opted in, just possibly not the highest-priority one. |
// | `issue_list_recently_closed` | **warning** | `issue:scout` widens its duplicate scan over what closed recently; a closed issue past the cut is one candidate the reader is not shown, exactly as on the open half. The scan ran, so it is reported beside the open one rather than failing the command. |
// | `issue_list_by_label_in_repo` | **error** | `epic:busy` asks whether a repository already has work running in it, and it is the only one whose answer *authorizes an action*. A truncated listing with no visible holder is not "nothing is running", and reading it as one starts a second run in the same checkout. It lands with the unreadable listing, on `wait`. It is also the only caller that reports the page ceiling **without** the `limit` cap beside it; `epic-busy.ts` records why a full page of parked issues must not latch the guard. |
//
// The split is applied caller by caller rather than copied: truncation is
// a warning where the scan *ran* and an error where the answer it produced would authorize an
// action. Only `epic:busy` authorizes one.
const { issue_list } = git_gh_issue_list

// The newest open issues, for the next-issues display at workflow completion. `createdAt`
// rides along because the caller re-sorts explicitly rather than inheriting the listing's order.
async function issue_list_recent(limit: number): Promise<IssueListOutcome> {
	return await issue_list({ json_fields: SUMMARY_FIELDS, limit })
}

// Every open issue with its title and body. Used by `epic:bundle` to scan the backlog and by
// `issue:scout` to compare titles before one is filed; a search with an empty term is not a listing,
// and asking `gh` for one produced a partial and arbitrary answer.
async function issue_list_open_bodies(limit: number): Promise<IssueListOutcome> {
	return await issue_list({ json_fields: BACKLOG_SCAN_FIELDS, limit })
}

// The issues that closed most recently, for the duplicate half of `issue:scout`.
// **The work most likely to be filed twice is the work that just
// finished**, and a scan that reads only open issues cannot see any of it.
//
// `sort=updated` rather than `created`: the question is what closed recently, and a listing ordered
// by filing date puts a five-year-old issue closed this morning behind whatever was filed yesterday.
// GitHub has no `sort=closed`, and `updated` moves on the close, so the newest-updated closed issues
// are the recently-closed ones with at most a few edited-since rows riding along — which cost a line
// in the candidate list and nothing else.
//
// **`labels` rather than `body`**, which is the one field list here that differs from the open scan's.
// The duplicate half compares titles and never reads a body, and the epic exclusion the open half
// gets for free — `epic_bundle_cli` marks a row from the *open* epic listing — cannot reach a closed
// row at all. Without the labels a closed epic would be offered as a duplicate of a deliverable, and
// under the new exit that reads as "this work is already done" against a container that never had an
// implementation of its own.
async function issue_list_recently_closed(limit: number): Promise<IssueListOutcome> {
	return await issue_list({
		json_fields: NUMBER_TITLE_AND_LABELS_FIELDS,
		limit,
		state: 'closed',
		sort: 'updated',
	})
}

// Open issues whose body mentions `term`. Used by `epic:audit` to find an issue that names an epic
// as its parent while the epic's task list does not track it.
//
// The one listing here whose filter runs client-side, and so the one that reaches the page ceiling
// on an ordinary repository: its matches are normally zero, so "stop once `limit` rows are selected"
// never fires for it.
async function issue_search_body(term: string, limit: number): Promise<IssueListOutcome> {
	return await issue_list({
		json_fields: NUMBER_AND_BODY_FIELDS,
		limit,
		body_term: term,
	})
}

async function issue_list_by_label(label: string, limit: number): Promise<IssueListOutcome> {
	return await issue_list({ json_fields: NUMBER_AND_BODY_FIELDS, limit, label })
}

// The same filter with the fields the `auto-ok` pickup needs: it orders by
// `createdAt`, re-checks `labels` client-side and reads each body for its declared restructures. A
// label that does not exist in the repository is not an error — the listing comes back empty, which
// is exactly "nobody has opted anything in".
// `json_fields` overrides the pickup's list. Its only caller is the probe that runs *after* a failed
// read, asking the same question without `blockedBy` so a refused dependencies endpoint is told
// apart from an access failure.
async function issue_list_by_label_summary(
	label: string,
	limit: number,
	options?: { json_fields?: string },
): Promise<IssueListOutcome> {
	return await issue_list({
		json_fields: options?.json_fields ?? PICKUP_FIELDS,
		limit,
		label,
	})
}

// Open issues carrying `label` in one named repository — the read `epic:next` makes before it
// offers a child, to see whether that repository already has one running.
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
	return await issue_list({ json_fields: SUMMARY_FIELDS, limit, label, repo })
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
	issue_list_recently_closed,
}

export { git_gh_issue, PICKUP_FIELDS, SUMMARY_FIELDS }
