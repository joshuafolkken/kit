import { describe, expect, it } from 'vitest'
import { issue_read } from './issue-read'

// The block `josh issue:read` prints (joshuafolkken/kit#1715).
//
// The cases are about the one distinction the command exists to preserve: a comment listing that came
// back empty and a comment listing nobody could read are different answers, and
// `.claude/skills/workflow-commands/SKILL.md` §2g decides from the later text — so a block that shows
// no comment where the read failed hands the reader a body a comment may already have overturned.

const ISSUE = '1715'
const TITLE = 'A title'
const BODY = 'The body'
const AUTHOR = 'someone'
const COMMENT_BODY = 'A comment'
const OPEN = 'open'
const FIELDS = { title: TITLE, state: OPEN, body: BODY }
const FIELDS_JSON = JSON.stringify(FIELDS)
const COMMENTS_JSON = JSON.stringify([
	{ user: { login: AUTHOR }, created_at: 'then', body: COMMENT_BODY },
])
const COMMENTS = [{ author: AUTHOR, created_at: 'then', body: COMMENT_BODY }]

describe('issue_read.parse_issue_fields', () => {
	it('reads the title, the state and the body', () => {
		expect(issue_read.parse_issue_fields(FIELDS_JSON)).toEqual(FIELDS)
	})

	it('reads an issue with no body as an empty body rather than refusing the read', () => {
		const json = JSON.stringify({ title: TITLE, state: OPEN })

		expect(issue_read.parse_issue_fields(json)?.body).toBe('')
	})

	// A well-formed response carrying something else is the same answer as malformed JSON here:
	// printing either as an issue is what this command exists to prevent.
	it('refuses a response that is not an issue', () => {
		expect(issue_read.parse_issue_fields('{"message":"API rate limit exceeded"}')).toBeUndefined()
		expect(issue_read.parse_issue_fields('not json')).toBeUndefined()
	})
})

describe('issue_read.parse_comments', () => {
	it('reads the author, the timestamp and the body of each comment', () => {
		expect(issue_read.parse_comments(COMMENTS_JSON)).toEqual(COMMENTS)
	})

	it('reads an empty listing as no comments', () => {
		expect(issue_read.parse_comments('[]')).toEqual([])
	})

	// `undefined` — never `[]` — so the block below can say which of the two answers it holds.
	it('refuses a listing that could not be read', () => {
		expect(issue_read.parse_comments(undefined)).toBeUndefined()
		expect(issue_read.parse_comments('not json')).toBeUndefined()
	})
})

describe('issue_read.format_issue', () => {
	it('names the issue the block belongs to, so a dropped number cannot shift the reading', () => {
		const block = issue_read.format_issue(ISSUE, FIELDS, [])

		expect(block).toContain(`${issue_read.ISSUE_LABEL}${ISSUE}`)
	})

	it('prints the title, the state, the body and each comment', () => {
		const block = issue_read.format_issue(ISSUE, FIELDS, COMMENTS)

		expect(block).toContain(TITLE)
		expect(block).toContain(BODY)
		expect(block).toContain(`${issue_read.COMMENT_HEADING}${AUTHOR}`)
		expect(block).toContain(COMMENT_BODY)
	})

	it('says an issue has no comments when the listing was read and was empty', () => {
		const block = issue_read.format_issue(ISSUE, FIELDS, [])

		expect(block).toContain(issue_read.NO_COMMENTS)
	})

	// The failure this command exists to prevent: a body read as the agreement in force because the
	// comment that overturned it was never printed.
	it('says the comments could not be read rather than showing none', () => {
		const block = issue_read.format_issue(ISSUE, FIELDS, undefined)

		expect(block).toContain(issue_read.COMMENTS_UNREADABLE)
		expect(block).not.toContain(issue_read.NO_COMMENTS)
	})

	it('says an issue has no body rather than printing a gap', () => {
		const block = issue_read.format_issue(ISSUE, { ...FIELDS, body: '' }, [])

		expect(block).toContain(issue_read.NO_BODY)
	})
})
