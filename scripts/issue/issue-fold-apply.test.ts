import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_fold_apply, type ApplyResult } from './issue-fold-apply'
import { issue_priority_raise, type RaiseResult } from './issue-priority-raise'

// joshuafolkken/kit#5848: the fold's write half — the gh reads and the PATCH are mocked so each refusal
// is read off the calls the write would have made.

const { issue_get_body, issue_edit_body, issue_list_comments } = vi.hoisted(() => ({
	issue_get_body: vi.fn<(issue_number: string) => Promise<string | undefined>>(),
	issue_edit_body: vi.fn<(issue_number: string, body: string) => Promise<string>>(),
	issue_list_comments: vi.fn<(issue_number: string) => Promise<string | undefined>>(),
}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_get_body, issue_edit_body, issue_list_comments },
}))

const ISSUE = '12'
const EXISTING = 'Original criterion'
const FOLDED = `${EXISTING}\n\n## 追加要件\n\nAdditional criterion\n`
const EDITED = `${EXISTING}\n\nA decision added later`
const FLOOR_FAILED: ApplyResult = 'priority-failed'
const ASSESSED_AT = '2026-11-02T12:00:00Z'
const ASSESSED_THREAD = JSON.stringify([{ id: 1, updated_at: ASSESSED_AT, body: 'Decision' }])

issue_list_comments.mockResolvedValueOnce(ASSESSED_THREAD)
const FOLD = {
	issue_number: ISSUE,
	existing_body: EXISTING,
	comment_fingerprint: (await issue_fold_apply.comment_fingerprint(ISSUE)) ?? 'unread',
	body: FOLDED,
}
const raise = vi.spyOn(issue_priority_raise, 'raise')

function reads(...bodies: ReadonlyArray<string | undefined>): void {
	for (const body of bodies) issue_get_body.mockResolvedValueOnce(body)
}

beforeEach(() => {
	raise.mockResolvedValue('below')
	issue_edit_body.mockResolvedValue('https://github.com/o/r/issues/12')
	issue_list_comments.mockResolvedValue(ASSESSED_THREAD)
})

afterEach(() => {
	vi.resetAllMocks()
})

describe('issue_fold_apply.apply after the write', () => {
	it('writes, raises the floor and verifies the re-read', async () => {
		reads(`${EXISTING}\r\n`, FOLDED.trimEnd())

		expect(await issue_fold_apply.apply(FOLD)).toBe('applied')
		expect(issue_edit_body).toHaveBeenCalledWith(ISSUE, FOLDED)
		expect(raise).toHaveBeenCalledWith(ISSUE)
	})

	it.each<RaiseResult>(['unreadable', 'failed'])(
		'reports a priority answer of %s as incomplete',
		async (answer) => {
			reads(EXISTING, FOLDED)
			raise.mockResolvedValue(answer)

			expect(await issue_fold_apply.apply(FOLD)).toBe(FLOOR_FAILED)
		},
	)

	it.each([[EXISTING], [undefined]])('reports a re-read of %s as unverified', async (reread) => {
		reads(EXISTING, reread)

		expect(await issue_fold_apply.apply(FOLD)).toBe('unverified')
	})
})

describe('issue_fold_apply.apply before the write', () => {
	it('refuses to write a body that changed since the assessment', async () => {
		reads(EDITED)

		expect(await issue_fold_apply.apply(FOLD)).toBe('changed')
		expect(issue_edit_body).not.toHaveBeenCalled()
	})

	it('refuses a body that reads as neither the assessment nor the fold', async () => {
		reads(EDITED, EDITED)

		expect(await issue_fold_apply.apply(FOLD)).toBe('changed')
		expect(raise).not.toHaveBeenCalled()
	})

	it('refuses to write a body it cannot read', async () => {
		reads(undefined)

		expect(await issue_fold_apply.apply(FOLD)).toBe('unreadable')
		expect(issue_edit_body).not.toHaveBeenCalled()
	})

	it('reports a failed write without raising the floor', async () => {
		reads(EXISTING)
		issue_edit_body.mockRejectedValue(new Error('gh failed'))

		expect(await issue_fold_apply.apply(FOLD)).toBe('write-failed')
		expect(raise).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#6643: a rerun after the split-child record failed finds its own fold written.
describe('issue_fold_apply.apply on a body that already carries the fold', () => {
	it('takes the earlier write as applied and only raises the floor', async () => {
		reads(FOLDED, `${FOLDED.trimEnd()}\r\n`)

		expect(await issue_fold_apply.apply(FOLD)).toBe('applied')
		expect(issue_edit_body).not.toHaveBeenCalled()
		expect(raise).toHaveBeenCalledWith(ISSUE)
	})

	it('reports a failed floor as incomplete', async () => {
		reads(FOLDED, FOLDED)
		raise.mockResolvedValue('failed')

		expect(await issue_fold_apply.apply(FOLD)).toBe(FLOOR_FAILED)
	})
})

describe('issue_fold_apply.apply against the assessed comments', () => {
	it.each([
		[
			'added',
			[
				{ id: 1, updated_at: ASSESSED_AT },
				{ id: 2, updated_at: ASSESSED_AT },
			],
		],
		['edited', [{ id: 1, updated_at: '2026-11-02T13:00:00Z' }]],
		['deleted', []],
	])('refuses to write when a comment was %s since the assessment', async (_change, thread) => {
		reads(EXISTING)
		issue_list_comments.mockResolvedValue(JSON.stringify(thread))

		expect(await issue_fold_apply.apply(FOLD)).toBe('changed')
		expect(issue_edit_body).not.toHaveBeenCalled()
	})

	it.each([[undefined], ['{"message":"Not Found"}']])(
		'refuses to write when the comments read as %s',
		async (thread) => {
			reads(EXISTING)
			issue_list_comments.mockResolvedValue(thread)

			expect(await issue_fold_apply.apply(FOLD)).toBe('unreadable')
			expect(issue_edit_body).not.toHaveBeenCalled()
		},
	)
})
