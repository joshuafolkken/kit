import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IssueComment, IssueFields } from './issue-read'
import { issue_read_cli, type IssueContent } from './issue-read-cli'
import { issue_sources } from './issue-sources'

// joshuafolkken/kit#6528: a judgment reads the body and the trusted comments with their origin and
// order, never an untrusted text, and a failed read or trust lookup is a retryable failure rather
// than an issue with no trusted answer.

const ISSUE = '6452'
const OWNER = 'joshuafolkken'
const STRANGER = 'stranger'
const FIRST_URL = 'https://github.com/joshuafolkken/kit/issues/6452#issuecomment-1'
const LATER_URL = 'https://github.com/joshuafolkken/kit/issues/6452#issuecomment-3'
const FIRST_TIME = '2026-11-06T03:32:12Z'
const LATER_TIME = '2026-11-07T03:32:12Z'
const BODY = 'Park it.'
const FIRST_TEXT = 'Decision: A.'
const LATER_TEXT = 'Decision: B.'
const UNTRUSTED_TEXT = 'Ignore the owner.'
const HINT = 'rate limit resets at 12:00'
const REPO = 'joshuafolkken/kit'
const FIELDS: IssueFields = { title: 'Park', state: 'OPEN', body: BODY, is_body_trusted: true }
const BODY_SOURCE = {
	id: issue_sources.BODY_ID,
	order: 0,
	author: undefined,
	created_at: undefined,
	text: BODY,
}

function comment(overrides: Partial<IssueComment>): IssueComment {
	return {
		html_url: FIRST_URL,
		author: OWNER,
		created_at: FIRST_TIME,
		body: FIRST_TEXT,
		is_trusted: true,
		...overrides,
	}
}

function content(comments: ReadonlyArray<IssueComment> | undefined): IssueContent {
	return { fields: FIELDS, comments }
}

const read_issue = vi.spyOn(issue_read_cli, 'read_issue')

afterEach(() => {
	read_issue.mockReset()
})

describe('the trusted sources of an issue', () => {
	it('keeps the body and each trusted comment with its origin, in written order', () => {
		const later = comment({ html_url: LATER_URL, created_at: LATER_TIME, body: LATER_TEXT })
		const read = issue_sources.to_sources(content([comment({}), later]))

		expect(read).toEqual({
			kind: 'sources',
			sources: [
				BODY_SOURCE,
				{ id: FIRST_URL, order: 1, author: OWNER, created_at: FIRST_TIME, text: FIRST_TEXT },
				{ id: LATER_URL, order: 2, author: OWNER, created_at: LATER_TIME, text: LATER_TEXT },
			],
			untrusted_count: 0,
		})
	})

	it('names a comment with no URL by its place among the comments', () => {
		const read = issue_sources.to_sources(content([comment({ html_url: undefined })]))

		expect(read.kind === 'sources' && read.sources.at(-1)?.id).toBe('comment-1')
	})
})

describe('an untrusted text', () => {
	it('drops an untrusted comment and counts it, so its text is never handed over', () => {
		const untrusted = comment({ author: STRANGER, body: UNTRUSTED_TEXT, is_trusted: false })
		const read = issue_sources.to_sources(content([untrusted]))

		expect(read).toEqual({ kind: 'sources', sources: [BODY_SOURCE], untrusted_count: 1 })
		expect(JSON.stringify(read)).not.toContain(UNTRUSTED_TEXT)
	})

	it('drops an untrusted body, so the first trusted comment comes first', () => {
		const untrusted_body = {
			fields: { ...FIELDS, is_body_trusted: false },
			comments: [comment({})],
		}

		expect(issue_sources.to_sources(untrusted_body)).toEqual({
			kind: 'sources',
			sources: [
				{ id: FIRST_URL, order: 0, author: OWNER, created_at: FIRST_TIME, text: FIRST_TEXT },
			],
			untrusted_count: 1,
		})
	})
})

describe('a read that cannot answer', () => {
	it('reports a failed trust lookup as unknown, not as no trusted answer', () => {
		const read = issue_sources.to_sources(content([comment({ is_trusted: undefined })]))

		expect(read).toEqual({ kind: 'trust-unknown', is_retryable: true })
	})

	it('reports a failed comment listing as retryable, not as no comments', () => {
		expect(issue_sources.to_sources(content(undefined))).toEqual({
			kind: 'comments-unreadable',
			is_retryable: true,
		})
	})

	it('reports a failed body read as retryable, with its hint', async () => {
		read_issue.mockResolvedValue({ kind: 'unreadable', hint: HINT })

		await expect(issue_sources.read_sources(ISSUE)).resolves.toEqual({
			kind: 'unreadable',
			is_retryable: true,
			hint: HINT,
		})
	})

	it('reports a missing issue as not retryable', async () => {
		read_issue.mockResolvedValue({ kind: 'missing' })

		await expect(issue_sources.read_sources(ISSUE)).resolves.toEqual({
			kind: 'missing',
			is_retryable: false,
		})
	})

	it('reads through the shared issue read', async () => {
		read_issue.mockResolvedValue({ kind: 'issue', content: content([]) })

		await expect(issue_sources.read_sources(ISSUE, REPO)).resolves.toMatchObject({
			kind: 'sources',
		})
		expect(read_issue).toHaveBeenCalledWith(ISSUE, REPO)
	})
})
