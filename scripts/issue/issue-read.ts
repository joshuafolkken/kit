import { parse_json_object_safe, read_json_listing } from '#scripts/git/parse-json-array'
import { z } from 'zod'

// The block `josh issue:read` prints for one issue, kept apart from the reading and the printing so
// the shape of the report is decided by one pure function — the seam `issue-state.ts` already has
// (joshuafolkken/kit#1715).
//
// **It exists because reading one issue costs a parent two turns.** `.claude/skills/workflow-commands/SKILL.md`
// §2g requires the body *and* the comments, since a decision recorded after the body was written
// lives only in a comment; typed by hand that is `gh api repos/{owner}/{repo}/issues/<N>` followed by
// `gh api repos/{owner}/{repo}/issues/<N>/comments`. Measured over four recorded `backlogrun`
// parents, `issue bookkeeping` was the single largest contributor to the parent's turn count — 110 of
// 414 turns, 26.6% — and one-issue-at-a-time `gh api` reads were its dominant shape. A parent's cost
// grows as n²/2 in its own request count (joshuafolkken/kit#1567), so those turns are the
// distribution this collapses.
//
// **The comments are never silently absent.** A listing that could not be read prints a line saying
// so, because a block showing no comment where the read failed is exactly the misread §2g exists to
// prevent: the agreement in force would be taken from a body a comment had already overturned.

const ISSUE_LABEL = 'issue: '
const TITLE_LABEL = 'title: '
const STATE_LABEL = 'state: '
const NO_BODY = '(no body)'
const NO_COMMENTS = '(no comments)'
// **Not `(no comments)`.** The two are opposite answers — one is a read that found nothing, the other
// is nothing having been read — and a caller acting on the first when it holds the second decides
// from a body a comment may already have superseded.
const COMMENTS_UNREADABLE = '(comments could not be read — this is not "there are no comments")'
const COMMENT_SEPARATOR = '\n\n'
const SECTION_SEPARATOR = '\n\n'
const COMMENT_HEADING = 'comment by '
const AT = ' at '

const issue_fields_schema = z.looseObject({
	title: z.string(),
	state: z.string(),
	body: z.string().optional(),
})

const comment_schema = z.looseObject({
	user: z.looseObject({ login: z.string() }).optional(),
	created_at: z.string().optional(),
	body: z.string().optional(),
})

interface IssueFields {
	title: string
	state: string
	body: string
}

interface IssueComment {
	author: string
	created_at: string
	body: string
}

const UNKNOWN_AUTHOR = '(unknown)'
const UNKNOWN_TIME = '(undated)'

// `undefined` for anything that is not an issue read — malformed JSON, and equally a well-formed
// response carrying something else (`{"message":"API rate limit exceeded"}`). Printing either as an
// issue is what this command exists to prevent, the same rule `issue-state.ts` states for its own
// parse.
function parse_issue_fields(json: string): IssueFields | undefined {
	try {
		const parsed = parse_json_object_safe(json, issue_fields_schema)

		if (parsed === undefined) return undefined

		return { title: parsed.title, state: parsed.state, body: parsed.body ?? '' }
	} catch {
		return undefined
	}
}

function to_comment(raw: z.infer<typeof comment_schema>): IssueComment {
	return {
		author: raw.user?.login ?? UNKNOWN_AUTHOR,
		created_at: raw.created_at ?? UNKNOWN_TIME,
		body: raw.body ?? '',
	}
}

// `undefined` — never `[]` — when the listing could not be read, so the block above can say which of
// the two answers it holds.
//
// **Through `read_json_listing`, which is what already reads this very endpoint** — the epic
// auto-close parses `issue_list_comments`'s output with it. Malformed JSON, a well-formed response
// carrying something else (`{"message":"API rate limit exceeded"}`) and a schema mismatch are three
// outcomes it already tells apart; a `JSON.parse` plus `safeParse` pair here would be the clone
// `CLAUDE.md` prohibits, on the one endpoint two modules would then parse two ways. All three collapse
// to `undefined` here, because the block above draws only one distinction: read, or not read.
function parse_comments(json: string | undefined): ReadonlyArray<IssueComment> | undefined {
	if (json === undefined) return undefined

	const listing = read_json_listing(json, comment_schema)

	return listing.kind === 'read' ? listing.rows.map((row) => to_comment(row)) : undefined
}

function format_comment(comment: IssueComment): string {
	const heading = `${COMMENT_HEADING}${comment.author}${AT}${comment.created_at}`

	return `${heading}\n${comment.body}`
}

function format_comments(comments: ReadonlyArray<IssueComment> | undefined): string {
	if (comments === undefined) return COMMENTS_UNREADABLE
	if (comments.length === 0) return NO_COMMENTS

	return comments.map((comment) => format_comment(comment)).join(COMMENT_SEPARATOR)
}

// The number, the title, the state, the body and every comment, in one block. **The number is on the
// block rather than left to position**, for the reason `issue-state.ts` gives: a batch read drops the
// numbers that resolve to nothing, and a positional reading then attributes every block after the gap
// to the wrong issue.
function format_issue(
	issue_number: string,
	fields: IssueFields,
	comments: ReadonlyArray<IssueComment> | undefined,
): string {
	const heading = `${ISSUE_LABEL}${issue_number}\n${TITLE_LABEL}${fields.title}\n${STATE_LABEL}${fields.state}`
	const body = fields.body === '' ? NO_BODY : fields.body

	return [heading, body, format_comments(comments)].join(SECTION_SEPARATOR)
}

const issue_read = {
	ISSUE_LABEL,
	TITLE_LABEL,
	STATE_LABEL,
	NO_BODY,
	NO_COMMENTS,
	COMMENTS_UNREADABLE,
	COMMENT_HEADING,
	format_issue,
	parse_comments,
	parse_issue_fields,
}

export type { IssueComment, IssueFields }
export { issue_read }
