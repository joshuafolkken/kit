import { gh_author_association } from '#scripts/gh/gh-author-association'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_read } from './issue-read'

// joshuafolkken/kit#4703: a write-access lookup that answered nothing is kept apart from `false`, so
// `run:entry` can name the failed read — and every printing site still reads it as untrusted.

const ISSUE = '4703'
const BODY = 'The body'
const COMMENT_BODY = 'A comment'
const FIELDS_JSON = JSON.stringify({ title: 'A title', state: 'open', body: BODY })
const COMMENTS_JSON = JSON.stringify([{ user: { login: 'someone' }, body: COMMENT_BODY }])

describe('issue_read — a write-access lookup that failed', () => {
	beforeEach(() => {
		vi.spyOn(gh_author_association, 'trust_of').mockResolvedValue(undefined)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('reads the body author as unanswered and prints the body under the untrusted heading', async () => {
		const fields = await issue_read.parse_issue_fields(FIELDS_JSON)
		const block = fields === undefined ? '' : issue_read.format_issue(ISSUE, fields, [])

		expect(fields?.is_body_trusted).toBeUndefined()
		expect(block).toContain(`${issue_read.UNTRUSTED_BODY_HEADING}\n${BODY}`)
	})

	it('reads the comment author as unanswered and withholds the comment', async () => {
		const fields = await issue_read.parse_issue_fields(FIELDS_JSON)
		const comments = await issue_read.parse_comments(COMMENTS_JSON)
		const block = fields === undefined ? '' : issue_read.format_issue(ISSUE, fields, comments)

		expect(comments?.[0]?.is_trusted).toBeUndefined()
		expect(block).toContain(issue_read.UNTRUSTED_COMMENT)
		expect(block).not.toContain(COMMENT_BODY)
		expect(issue_read.trusted_bodies(comments ?? [])).toEqual([])
	})
})
