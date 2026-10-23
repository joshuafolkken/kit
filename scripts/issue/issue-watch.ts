import { gh_author_association } from '#scripts/gh/gh-author-association'
import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_conditional } from '#scripts/gh/git-gh-conditional'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_command } from '#scripts/git/git-command'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { issue_watch_diff, type WatchSnapshot } from './issue-watch-diff'

// The record of what a run last read of its issue, and the poll that compares the issue against it.
//
// **The baseline is written where the run reads the issue** — `josh run:entry`, which prints the body
// and every comment — so it is the same for a dispatched lane child and a `fullrun` in a person's own
// checkout, and a resume that prints nothing keeps the baseline it had. One record per checkout,
// keyed on its root like the review attestation, carries the issue number, so the hook needs no other
// way to learn which issue the session works on.
//
// **A poll is a conditional request.** The issue object's ETag changes with its body and with its
// comment count, so a 304 there means neither moved and the comments are not read at all.

const RECORD_PREFIX = 'josh-issue-watch-'
const CLOSED_STATE = 'closed'

const record_schema = z.object({
	issue: z.string(),
	body: z.string(),
	last_comment_id: z.number(),
	acknowledged_at: z.string(),
	checked_at: z.string(),
	etag: z.string().optional(),
	pending: z.string().optional(),
	// A body edit withheld from the run (`issue_watch_diff.withheld_notice`) — shown, never a hold.
	notice: z.string().optional(),
	shown: z.string().optional(),
})

const issue_schema = z.looseObject({
	body: z.string().nullish(),
	state: z.string(),
	...gh_author_association.author_fields_schema,
})

type IssueRead = z.infer<typeof issue_schema>

type WatchRecord = z.infer<typeof record_schema>

type Fetched =
	| { kind: 'unchanged' }
	| { kind: 'unreadable' }
	| { kind: 'closed' }
	| { kind: 'read'; snapshot: WatchSnapshot; etag: string | undefined }

const UNREADABLE: Fetched = { kind: 'unreadable' }

function record_path(root: string = PROJECT_ROOT): string {
	return stamp_file.stamp_path(RECORD_PREFIX, root)
}

function read_record(root?: string): WatchRecord | undefined {
	const raw = stamp_file.read_stamp_text(record_path(root))

	return raw === undefined ? undefined : json_value.parse_with(raw, record_schema)
}

function write_record(record: WatchRecord, root?: string): WatchRecord {
	stamp_file.replace_stamp(record_path(root), record)

	return record
}

function clear(root?: string): void {
	stamp_file.remove_stamp(record_path(root))
}

interface FetchRequest {
	issue: string
	etag?: string | undefined
	timeout_ms?: number | undefined
}

async function read_comments(
	request: FetchRequest,
): Promise<WatchSnapshot['comments'] | undefined> {
	return await issue_watch_diff.parse_comments(
		await git_gh_issue_read.issue_list_comments(request.issue, request.timeout_ms),
		request.timeout_ms,
	)
}

async function read_snapshot(
	request: FetchRequest,
	issue: IssueRead,
	etag: string | undefined,
): Promise<Fetched> {
	const [comments, is_body_trusted] = await Promise.all([
		read_comments(request),
		gh_author_association.trust_of(gh_author_association.author_of(issue, request.timeout_ms)),
	])

	if (comments === undefined) return UNREADABLE

	return { kind: 'read', snapshot: { body: issue.body ?? '', is_body_trusted, comments }, etag }
}

async function fetch_issue(request: FetchRequest): Promise<Fetched> {
	const read = await git_gh_conditional.read_conditional(
		git_gh_api_path.issue_api_path(request.issue),
		request.etag,
		request.timeout_ms,
	)

	if (read.kind !== 'changed') return read

	const fields = json_value.parse_with(read.body, issue_schema)

	if (fields === undefined) return UNREADABLE
	if (fields.state === CLOSED_STATE) return { kind: 'closed' }

	return await read_snapshot(request, fields, read.etag)
}

// `acknowledged_at` is when a person's update was last taken in — the baseline's own read, or an
// acknowledgement that had something to take in. The review attestation compares it with the brief.
function fresh_record(
	issue: string,
	fetched: Extract<Fetched, { kind: 'read' }>,
	now: Date,
	acknowledged_at: string = now.toISOString(),
): WatchRecord {
	const baseline = issue_watch_diff.baseline_of(fetched.snapshot)
	const checked_at = now.toISOString()

	return { issue, ...baseline, acknowledged_at, checked_at, etag: fetched.etag }
}

// Called by `josh run:entry` once it has printed the issue. `false` when the issue could not be read,
// which leaves no record — a watch with no baseline would call the whole issue unread.
async function record_baseline(
	issue: string,
	root?: string,
	now: Date = new Date(),
): Promise<boolean> {
	const fetched = await fetch_issue({ issue })

	if (fetched.kind !== 'read') return false

	write_record(fresh_record(issue, fetched, now), root)

	return true
}

// The `_here` forms key the record on the repository root rather than `process.cwd()`, the same reason
// `review_attest.check_here` does: a run started from a subdirectory must find the record it wrote.
async function record_baseline_here(issue: string): Promise<boolean> {
	return await record_baseline(issue, await git_command.repository_root())
}

async function clear_here(): Promise<void> {
	clear(await git_command.repository_root())
}

function with_fetched(record: WatchRecord, fetched: Fetched, checked_at: string): WatchRecord {
	if (fetched.kind !== 'read') return { ...record, checked_at }

	const pending = issue_watch_diff.unread_diff(record, fetched.snapshot)
	const notice = issue_watch_diff.withheld_notice(record, fetched.snapshot)

	return { ...record, checked_at, etag: fetched.etag, pending, notice }
}

interface PollOptions {
	interval_ms: number
	timeout_ms?: number
	now?: Date
}

function is_due(record: WatchRecord, options: PollOptions, now: Date): boolean {
	return now.getTime() - Date.parse(record.checked_at) >= options.interval_ms
}

async function refresh(
	record: WatchRecord,
	options: PollOptions,
	now: Date,
	root?: string,
): Promise<WatchRecord | undefined> {
	const fetched = await fetch_issue({
		issue: record.issue,
		etag: record.etag,
		timeout_ms: options.timeout_ms,
	})

	if (fetched.kind === 'closed') {
		clear(root)

		return undefined
	}

	return write_record(with_fetched(record, fetched, now.toISOString()), root)
}

// The checkout's record, polled when the last poll is at least `interval_ms` old. `undefined` when no
// run recorded a baseline here, or the issue has closed — a closed issue ends its watch.
async function poll(options: PollOptions, root?: string): Promise<WatchRecord | undefined> {
	const record = read_record(root)
	const now = options.now ?? new Date()

	if (record === undefined || !is_due(record, options, now)) return record

	return await refresh(record, options, now, root)
}

// What the hook shows: a pending update, else a withheld edit's notice.
function news_of(record: WatchRecord): string | undefined {
	return record.pending ?? record.notice
}

// Marks the news shown, so the hook stops once per update rather than on every call.
function mark_shown(record: WatchRecord, root?: string): WatchRecord {
	return write_record({ ...record, shown: news_of(record) }, root)
}

interface Acknowledged {
	issue: string
	diff: string | undefined
}

// `josh issue:ack`: read the issue as it is now, return what changed since the baseline, and make
// that the new baseline. **What is returned is exactly what is acknowledged** — the read and the new
// baseline are the same snapshot, so an update landing between the two cannot be acknowledged unseen.
async function acknowledge(
	root?: string,
	now: Date = new Date(),
): Promise<Acknowledged | undefined> {
	const record = read_record(root)

	if (record === undefined) return undefined

	const fetched = await fetch_issue({ issue: record.issue })

	if (fetched.kind !== 'read') return undefined

	const diff = issue_watch_diff.unread_diff(record, fetched.snapshot)

	const acknowledged_at = diff === undefined ? record.acknowledged_at : now.toISOString()

	write_record(fresh_record(record.issue, fetched, now, acknowledged_at), root)

	return { issue: record.issue, diff }
}

const issue_watch = {
	acknowledge,
	clear,
	clear_here,
	mark_shown,
	news_of,
	poll,
	read_record,
	record_baseline,
	record_baseline_here,
	record_path,
}

export type { Acknowledged, PollOptions, WatchRecord }
export { issue_watch }
