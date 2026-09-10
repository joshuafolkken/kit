import { git_gh_command } from '#scripts/git/git-gh-command'
import {
	ALREADY_DONE_LABEL,
	has_any_label,
	IN_PROGRESS_LABEL,
	NEEDS_DECISION_LABEL,
} from '#scripts/git/issue-labels'
import { read_json_listing } from '#scripts/git/parse-json-array'
import { open_issue_schema, type OpenIssueData } from '#scripts/git/schemas'

// How much of a repository's parallelism is already spoken for — asked of the *repository*, never of
// the epic (joshuafolkken/kit#925), and counted rather than treated as a yes/no since
// joshuafolkken/kit#1491.
//
// `epic-classify.ts` sorts only the children the epic tracks, so an `in-progress` issue belonging to
// a *different* epic is invisible to it: start two `epicrun`s and both answer "nothing of mine is in
// progress". This read is what closes that gap, and it is deliberately outside the classification —
// the question is not about the graph.
//
// **What an `in-progress` issue holds is one lane, not the repository.** Until joshuafolkken/kit#1490
// the contended resource really was one working tree, one `main` and one `pnpm-lock.yaml`, so one
// holder excluded everything. A lane is its own checkout with its own branch and its own ports, so
// the question stopped being "is anything running" and became "how many are running" — and the
// answer is a count the caller compares against `lane_capacity`'s limit.
//
// **The count is read from GitHub, never kept in the session.** Two `epicrun`s counting to six in
// their own memory give twelve lanes; the label on an open issue is the one record both of them
// read. It is an advisory guard rather than a mutex — the label is applied after the read, so two
// sessions starting in the same instant can still take one seat twice. What it closes is the window
// that actually occurs: a lane holding the label for minutes.

// Wide enough that the cap is never what decides the answer: a repository with a hundred issues
// carrying `in-progress` at once is already the state this guard exists to report.
const LISTING_LIMIT = 100

// Read through `has_any_label` rather than compared directly, for the casing reason
// `issue-labels.ts` records: GitHub keeps the spelling a label was created with.
//
// `already-done` joins `needs-decision` here for the same reason it joins it in
// `epic_classify.local_category` (joshuafolkken/kit#1679): the run that applied it committed
// nothing, so the checkout it ran in is clean and there is no uncommitted work for the next child to
// start on top of. That is exactly what separates both from `needs-human-review`, which is
// deliberately not parked because its work is still sitting in the tree.
const PARKED_LABELS: ReadonlySet<string> = new Set([NEEDS_DECISION_LABEL, ALREADY_DONE_LABEL])

// What one repository answered. `unreadable` is kept apart from `idle` for the reason
// joshuafolkken/kit#950 records: reading a failed read as an empty listing is a confident absence
// built on a response nobody parsed — and here that absence *starts* work, which is the one
// direction a guard must never fail in.
//
// **`epic:next` answers `wait` for it, rather than exiting.** The other candidate was an error exit,
// as an unreadable *child* already produces — but `issue_list` swallows every failure into
// `undefined`, a passing rate limit included, and this read happens on every poll of every session,
// so an exit would end an unattended run over a blip. A persistent failure never arrives here: the
// children are read first, and one that could not be read is already an anomaly that exits 1. What
// is left at this line is transient, and `wait` self-heals where an exit needs a person.
//
// **`truncated` is kept apart from `idle` for the same reason, one step further in**
// (joshuafolkken/kit#1067). Since the page ceiling applies to every listing, a listing can now come
// back well-formed, short, and missing the very issue that holds this repository — and "no holder in
// the rows I was given" is not "no holder". It is grouped with `unreadable` rather than with `idle`
// because what it authorizes is identical: nothing. It gets its own kind only so the message names
// the real cause — `unreadable_message` sends a reader to `gh auth status`, which is green here.
type BusyRead =
	| { kind: 'idle' }
	| { kind: 'busy'; issues: ReadonlyArray<OpenIssueData> }
	| { kind: 'unreadable' }
	| { kind: 'truncated' }

// Named so the reader can go and look at them: the stale-label rule is what keeps an abandoned
// `in-progress` from holding a repository forever, and it cannot be applied to an issue nobody was
// told about.
function format_holders(issues: ReadonlyArray<OpenIssueData>): string {
	return issues.map((issue) => `#${String(issue.number)} ${issue.title}`).join(', ')
}

// How many lanes this read shows occupied. Every kind but `busy` is zero, and the two that could not
// see the whole listing are held back by their kind rather than by their count — a read that saw
// nothing is not a repository with nothing running, and the caller checks the kind first.
function occupied_lanes(read: BusyRead): number {
	return read.kind === 'busy' ? read.issues.length : 0
}

// Named holders rather than a bare count, for the reason the stale-label rule needs: it is applied
// by whoever finds the label stale, and it cannot be applied to an issue nobody was told about.
function occupancy_message(
	issues: ReadonlyArray<OpenIssueData>,
	repo: string,
	limit: number,
): string {
	return `${String(issues.length)} of ${String(limit)} lanes in use in ${repo}: ${format_holders(issues)}.`
}

// The occupancy said once, with the consequence appended — rather than a second sentence that
// re-derives the same numbers and can drift from the first.
function lanes_full_message(
	issues: ReadonlyArray<OpenIssueData>,
	repo: string,
	limit: number,
): string {
	return `${occupancy_message(issues, repo, limit)} No lane is free, so nothing is offered here. A lane is released when its child merges or is parked; if a label is stale, remove it and ask again, and \`JOSH_LANE_LIMIT\` is what raises the ceiling.`
}

function unreadable_message(repo: string): string {
	return `Could not read the \`${IN_PROGRESS_LABEL}\` listing for ${repo}. That is not "nothing is running" — check \`gh auth status\` and ask again.`
}

// Said in the `⚠ … cap` shape joshuafolkken/kit#1033 settled on, because it is the same kind of
// statement: the read happened and covered less than the whole listing. What it means here is
// stronger than elsewhere, so the message says the consequence out loud rather than leaving a reader
// to infer it from a warning marker.
//
// **It does not tell anyone to clear stale labels, the way `lanes_full_message` does.** The only cut that
// reaches here is the page ceiling, which needs hundreds of labelled pull requests to fire — nothing
// an issue label can clear, and nothing asking again will resolve either. So it names what the run
// is waiting on and sends the reader to the one thing that would change the answer.
function truncated_message(repo: string): string {
	return `⚠ The \`${IN_PROGRESS_LABEL}\` listing for ${repo} could not be read to the end, so an issue holding that repository may not be in it. That is not "nothing is running" — nothing is offered here, and asking again will not clear it. Narrow what carries \`${IN_PROGRESS_LABEL}\` in that repository, or run this child there by hand.`
}

// Which of the three non-idle answers to print, by kind rather than by fall-through. `idle` has no
// message — it is the branch that offers the child — and a kind added later gets a compile error at
// the table instead of silently inheriting the unreadable listing's advice, which would send a
// reader to `gh auth status` for something that has nothing to do with it.
const BUSY_REASONS: Readonly<
	Record<Exclude<BusyRead['kind'], 'busy' | 'idle'>, (repo: string) => string>
> = {
	unreadable: unreadable_message,
	truncated: truncated_message,
}

function busy_reason(read: BusyRead, repo: string, limit: number): string {
	if (read.kind === 'busy') return lanes_full_message(read.issues, repo, limit)
	if (read.kind === 'idle') return ''

	return BUSY_REASONS[read.kind](repo)
}

// A parked issue does not hold a lane, and this is not a special case bolted on: it is the
// precedence `epic_classify.local_category` already applies, which reads `needs-decision` *before*
// `in-progress` and so calls a parked child `human` rather than `time`. Two readings of one issue
// have to agree, and without this they do not — nothing removes `in-progress` when a child is
// parked, so `park and continue` would spend a lane on the very child it just set aside, and with
// one lane the run would poll instead of continuing (joshuafolkken/kit#925). A child stopped by
// `needs-human-review` is deliberately not parked and goes on holding its lane: its uncommitted work
// is still sitting in that checkout.
function is_parked(issue: OpenIssueData): boolean {
	return has_any_label(issue.labels, PARKED_LABELS)
}

// A listing that arrived, or a gap. The shared reader tells the two gaps apart — output that is not
// a listing from elements the schema rejects — and both are `unreadable` here: this guard has one
// safe answer and it is the same for either, while the `auto-ok` pickup names them separately.
//
// A holder that *is* visible settles the question whatever the paging did — something is running,
// which is the answer — so `is_capped` is consulted only when no holder came back.
//
// **`is_capped` alone, not the `limit` cap the other callers also report.** A page ceiling here means
// the paging could not reach `limit` at all, which normal operation does not produce and which
// nothing the run can do will clear — waiting is the right answer and it is a state a person has to
// look at. A *filled* `limit` is different: `epicrun` parks a child by adding `needs-decision` and
// **leaving `in-progress` on**, so parked issues accumulate under this label, and a hundred of them
// would fill the listing with rows this function then discards as non-holders. Calling that
// truncated answers `wait` on every ask, for a condition nothing resolves — one stalled repository
// for every epic, traded against the second run one possibly-hidden holder would allow. The `wait`
// this guard is built on is the kind a holder finishing clears, and that one is not it.
function parse_listing(raw: string, is_capped: boolean): BusyRead {
	const read = read_json_listing(raw, open_issue_schema)
	if (read.kind !== 'read') return { kind: 'unreadable' }

	const holders = read.rows.filter((row) => !is_parked(row))
	if (holders.length > 0) return { kind: 'busy', issues: holders }

	return is_capped ? { kind: 'truncated' } : { kind: 'idle' }
}

// The label filter is the query's job — membership is what makes the listing the running set, so
// re-testing it here would be a second definition of "running".
async function read_repository(repo: string): Promise<BusyRead> {
	const { json, is_capped } = await git_gh_command.issue_list_by_label_in_repo(
		IN_PROGRESS_LABEL,
		LISTING_LIMIT,
		repo,
	)

	return json === undefined ? { kind: 'unreadable' } : parse_listing(json, is_capped)
}

const epic_busy = {
	LISTING_LIMIT,
	occupied_lanes,
	occupancy_message,
	lanes_full_message,
	unreadable_message,
	truncated_message,
	busy_reason,
	format_holders,
	is_parked,
	parse_listing,
	read_repository,
}

export type { BusyRead }
export { epic_busy }
