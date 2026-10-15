import { read_json_listing } from '#scripts/git/parse-json-array'
import { z } from 'zod'

// What a person changed on an issue since a run last read it, as the one pure answer the hook, the
// review attestation, `josh issue:ack` and `josh followup` all print. Kept free of I/O so the four
// callers cannot each draw the line between "a person's update" and "noise" differently.
//
// **A person's update is a body edit or a comment nobody automated.** A bot's comment (`type: Bot`,
// or a `[bot]` login) is not one. A run's own comment is posted under the person's own `gh` login,
// so the login cannot tell the two apart; `git-gh-issue-write.ts` stamps every comment josh posts
// with `RUN_MARKER`, and a marked comment is not one either. An unmarked comment written by hand
// through a raw `gh api` counts as a person's — the direction that costs one `josh issue:ack`, never a
// missed correction.
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
})

interface WatchComment {
	id: number
	author: string
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

function is_automated(user: z.infer<typeof comment_schema>['user'], body: string): boolean {
	return is_bot(user) || body.includes(RUN_MARKER)
}

function to_comment(raw: z.infer<typeof comment_schema>): WatchComment {
	const body = raw.body ?? ''
	const author = raw.user?.login ?? UNKNOWN_AUTHOR
	const created_at = raw.created_at ?? UNKNOWN_TIME

	return { id: raw.id, author, is_automated: is_automated(raw.user, body), created_at, body }
}

// `undefined` — never `[]` — for a listing that could not be read, so a failed read is never taken
// for "nobody commented".
function parse_comments(json: string | undefined): ReadonlyArray<WatchComment> | undefined {
	if (json === undefined) return undefined

	const listing = read_json_listing(json, comment_schema)

	return listing.kind === 'read' ? listing.rows.map((row) => to_comment(row)) : undefined
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
		(comment) => comment.id > baseline.last_comment_id && !comment.is_automated,
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
