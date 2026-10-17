import { gh_author_association } from '#scripts/gh/gh-author-association'
import { read_json_listing } from '#scripts/git/parse-json-array'
import { z } from 'zod'

// What a person changed on an issue since a run last read it, as the one answer the hook, the review
// attestation, `josh issue:ack` and `josh followup` all print. Kept in one place so the four callers
// cannot each draw the line between "a person's update" and "noise" differently; its only I/O is the
// write-access lookup `gh_author_association` makes for a `MEMBER` / `COLLABORATOR`.
//
// **A person's update is a body edit or a comment nobody automated.** A bot's comment (`type: Bot`,
// or a `[bot]` login) is not one. A run's own comment is posted under the person's own `gh` login,
// so the login cannot tell the two apart; `git-gh-issue-write.ts` stamps every comment josh posts
// with `RUN_MARKER`, and a marked comment is not one either. An unmarked comment written by hand
// through a raw `gh api` counts as a person's — the direction that costs one `josh issue:ack`, never a
// missed correction.
//
// **Only an author with write access is a person here** (`gh_author_association`). On a public
// repository anyone can comment, so a comment from anyone else is never handed to a run as an update,
// and its `RUN_MARKER` is not taken as josh's own.
//
// **Comment edits are out of scope.** A new comment carries an id above the baseline's; an edited
// one keeps its id and is not seen. The body is compared whole, so its edits are.

const RUN_MARKER = '<!-- josh:run -->'
const BOT_TYPE = 'Bot'
const BOT_SUFFIX = '[bot]'
const NO_COMMENT_ID = 0
const UNKNOWN_AUTHOR = '(unknown)'
const UNKNOWN_TIME = '(undated)'

const BODY_HEADING = 'Body edited:'
const REMOVED_PREFIX = '- '
const ADDED_PREFIX = '+ '
const COMMENT_HEADING = 'New comment by '
const AT = ' at '
const SECTION_SEPARATOR = '\n\n'
const LINE_SEPARATOR = '\n'
const CRLF = '\r\n'

const comment_schema = z.looseObject({
	id: z.number(),
	user: z.looseObject({ login: z.string(), type: z.string().optional() }).nullish(),
	created_at: z.string().optional(),
	body: z.string().nullish(),
	author_association: z.string().nullish(),
})

interface WatchComment {
	id: number
	author: string
	is_trusted: boolean
	is_automated: boolean
	created_at: string
	body: string
}

interface WatchSnapshot {
	body: string
	comments: ReadonlyArray<WatchComment>
}

interface WatchBaseline {
	body: string
	last_comment_id: number
}

function is_bot(user: z.infer<typeof comment_schema>['user']): boolean {
	return user?.type === BOT_TYPE || (user?.login.endsWith(BOT_SUFFIX) ?? false)
}

function is_automated(raw: z.infer<typeof comment_schema>, is_trusted: boolean): boolean {
	return is_bot(raw.user) || (is_trusted && (raw.body?.includes(RUN_MARKER) ?? false))
}

async function to_comment(
	raw: z.infer<typeof comment_schema>,
	timeout_ms?: number,
): Promise<WatchComment> {
	const login = raw.user?.login
	const is_trusted = await gh_author_association.is_trusted({
		login,
		association: raw.author_association,
		timeout_ms,
	})

	return {
		id: raw.id,
		author: login ?? UNKNOWN_AUTHOR,
		is_trusted,
		is_automated: is_automated(raw, is_trusted),
		created_at: raw.created_at ?? UNKNOWN_TIME,
		body: raw.body ?? '',
	}
}

// `undefined` — never `[]` — for a listing that could not be read, so a failed read is never taken
// for "nobody commented". `timeout_ms` bounds each write-access lookup, which run concurrently, so a
// hook's read stays inside its own timeout.
async function parse_comments(
	json: string | undefined,
	timeout_ms?: number,
): Promise<ReadonlyArray<WatchComment> | undefined> {
	if (json === undefined) return undefined

	const listing = read_json_listing(json, comment_schema)

	if (listing.kind !== 'read') return undefined

	return await Promise.all(listing.rows.map(async (row) => await to_comment(row, timeout_ms)))
}

function last_comment_id(comments: ReadonlyArray<WatchComment>): number {
	return Math.max(NO_COMMENT_ID, ...comments.map((comment) => comment.id))
}

function baseline_of(snapshot: WatchSnapshot): WatchBaseline {
	return { body: snapshot.body, last_comment_id: last_comment_id(snapshot.comments) }
}

function lines_missing_from(source: string, other: string): Array<string> {
	const present = new Set(other.split(LINE_SEPARATOR))

	return source.split(LINE_SEPARATOR).filter((line) => line.trim() !== '' && !present.has(line))
}

// GitHub stores a body saved in its web editor with CRLF line endings, so one edited line to a body
// josh wrote over the API with LF would otherwise read as every line removed and added.
function to_lf(body: string): string {
	return body.split(CRLF).join(LINE_SEPARATOR)
}

// The lines that left and the lines that arrived — not a positional diff, which would need a
// dependency in a hook that runs on every tool call, and a reader comparing a spec only needs which
// sentences changed.
function body_section(previous_raw: string, current_raw: string): string | undefined {
	const previous = to_lf(previous_raw)
	const current = to_lf(current_raw)

	if (previous === current) return undefined

	const removed = lines_missing_from(previous, current).map((line) => `${REMOVED_PREFIX}${line}`)
	const added = lines_missing_from(current, previous).map((line) => `${ADDED_PREFIX}${line}`)

	return [BODY_HEADING, ...removed, ...added].join(LINE_SEPARATOR)
}

function comment_section(comment: WatchComment): string {
	return `${COMMENT_HEADING}${comment.author}${AT}${comment.created_at}${LINE_SEPARATOR}${comment.body}`
}

function new_person_comments(
	baseline: WatchBaseline,
	snapshot: WatchSnapshot,
): ReadonlyArray<WatchComment> {
	return snapshot.comments.filter(
		(comment) =>
			comment.id > baseline.last_comment_id && comment.is_trusted && !comment.is_automated,
	)
}

// The unread update as the text a run is shown, or `undefined` when a person changed nothing.
function unread_diff(baseline: WatchBaseline, snapshot: WatchSnapshot): string | undefined {
	const body = body_section(baseline.body, snapshot.body)
	const comments = new_person_comments(baseline, snapshot).map((comment) =>
		comment_section(comment),
	)
	const sections = [...(body === undefined ? [] : [body]), ...comments]

	return sections.length === 0 ? undefined : sections.join(SECTION_SEPARATOR)
}

const issue_watch_diff = {
	RUN_MARKER,
	baseline_of,
	parse_comments,
	unread_diff,
}

export type { WatchBaseline, WatchComment, WatchSnapshot }
export { issue_watch_diff }
