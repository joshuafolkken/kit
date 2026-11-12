import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_outcome } from './issue-outcome'
import { issue_read, type IssueComment } from './issue-read'

const EXAMPLES = [
	{
		summary: 'No redundant hops found',
		url: 'https://github.com/joshuafolkken/kit/issues/7389#issuecomment-6818718015',
	},
	{
		summary: 'Setup cost not isolated',
		url: 'https://github.com/joshuafolkken/kit/issues/7388#issuecomment-6818685392',
	},
	{
		summary: 'Sonar fixed; timeout not reproduced',
		url: 'https://github.com/joshuafolkken/kit/issues/7383#issuecomment-6818765247',
	},
]
const [EXAMPLE] = EXAMPLES
const URL = 'https://github.com/owner/repo/issues/1#issuecomment-1'
const SUMMARY = 'No change needed'
const NOTE = 'Ordinary note'

function comment(body: string, url = URL): IssueComment {
	return { body, html_url: url, author: 'owner', created_at: '', is_trusted: true }
}

function marked(summary = SUMMARY): string {
	return issue_outcome.body_of({ body: '## Evidence', summary })
}

afterEach(() => vi.restoreAllMocks())

describe('issue_outcome — evidence selection', () => {
	it.each(EXAMPLES)('keeps $summary linked to its historic evidence', (outcome) => {
		const body = issue_outcome.body_of({ body: '記録済みの調査結果', summary: outcome.summary })
		const comments = [comment(body, outcome.url), comment('Its lane was withdrawn')]

		expect(issue_outcome.from_comments(comments)).toStrictEqual(outcome)
	})

	it('backfills an existing evidence comment without selecting the last management note', () => {
		const url = `${URL}0`
		const body = issue_outcome.body_of({ body: 'Outcome recorded', summary: SUMMARY, url })

		expect(issue_outcome.from_comments([comment('Evidence', url), comment(body)])).toStrictEqual({
			summary: SUMMARY,
			url,
		})
	})

	it.each(['ordinary history', '<!-- josh:outcome {} -->', '<!-- josh:outcome bad -->'])(
		'leaves an unstructured or invalid record unread: %s',
		(body) => {
			expect(issue_outcome.from_comments([comment(body)])).toBeUndefined()
		},
	)

	it('ignores untrusted, missing, or foreign evidence', () => {
		const foreign = issue_outcome.body_of({ body: 'note', summary: SUMMARY, url: EXAMPLE?.url })
		const untrusted = { ...comment(marked()), is_trusted: false }
		const unsafe = comment(marked(), `${URL}\n`)

		expect(issue_outcome.from_comments([untrusted])).toBeUndefined()
		expect(issue_outcome.from_comments([comment(foreign)])).toBeUndefined()
		expect(issue_outcome.from_comments([unsafe])).toBeUndefined()
	})
})

describe('issue_outcome — one-line English records', () => {
	it.each(['line\nbreak', 'escape\u{1B}]8;;url\u{7}', '日本語', 'x'.repeat(81), ''])(
		'refuses an unsafe or overlong summary: %s',
		(summary) => {
			expect(() => marked(summary)).toThrow()
			const body = `<!-- josh:outcome ${JSON.stringify({ summary })} -->`

			expect(issue_outcome.from_comments([comment(body)])).toBeUndefined()
		},
	)

	it('leaves ordinary comment bodies unchanged', () => {
		expect(issue_outcome.body_of({ body: NOTE })).toBe(NOTE)
	})

	it('returns no invented reason on a failed comment read', async () => {
		vi.spyOn(git_gh_issue_read, 'issue_list_comments').mockResolvedValue(undefined)

		await expect(issue_outcome.read(1)).resolves.toBeUndefined()
	})

	it('reads trusted evidence through the existing conditional comment reader', async () => {
		const read = vi.spyOn(git_gh_issue_read, 'issue_list_comments').mockResolvedValue('[]')

		vi.spyOn(issue_read, 'parse_comments').mockResolvedValue([comment(marked())])

		await expect(issue_outcome.read(1)).resolves.toStrictEqual({ summary: SUMMARY, url: URL })
		expect(read).toHaveBeenCalledWith(
			'1',
			undefined,
			undefined,
			git_gh_issue_read.read_comments_conditionally,
		)
	})
})

describe('issue_outcome.recorded', () => {
	it('skips comment reads for a merged issue', async () => {
		const read = vi.spyOn(git_gh_issue_read, 'issue_list_comments')

		await expect(issue_outcome.recorded(1, true)).resolves.toStrictEqual({})
		expect(read).not.toHaveBeenCalled()
	})

	it.each([
		{ comments: [], expected: {} },
		{ comments: [comment(marked())], expected: { outcome: { summary: SUMMARY, url: URL } } },
	])('records only available evidence: $expected', async ({ comments, expected }) => {
		vi.spyOn(git_gh_issue_read, 'issue_list_comments').mockResolvedValue('[]')
		vi.spyOn(issue_read, 'parse_comments').mockResolvedValue(comments)

		await expect(issue_outcome.recorded(1, false)).resolves.toStrictEqual(expected)
	})
})
