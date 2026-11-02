import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_fold_apply } from './issue-fold-apply'
import { issue_priority_raise, type RaiseResult } from './issue-priority-raise'

// joshuafolkken/kit#5848: the fold's write half — the gh reads and the PATCH are mocked so each refusal
// is read off the calls the write would have made.

const { issue_get_body, issue_edit_body } = vi.hoisted(() => ({
	issue_get_body: vi.fn<(issue_number: string) => Promise<string | undefined>>(),
	issue_edit_body: vi.fn<(issue_number: string, body: string) => Promise<string>>(),
}))

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_get_body, issue_edit_body },
}))

const ISSUE = '12'
const EXISTING = 'Original criterion'
const FOLDED = `${EXISTING}\n\n## 追加要件\n\nAdditional criterion\n`
const FOLD = { issue_number: ISSUE, existing_body: EXISTING, body: FOLDED }
const raise = vi.spyOn(issue_priority_raise, 'raise')

function reads(...bodies: ReadonlyArray<string | undefined>): void {
	for (const body of bodies) issue_get_body.mockResolvedValueOnce(body)
}

beforeEach(() => {
	raise.mockResolvedValue('below')
	issue_edit_body.mockResolvedValue('https://github.com/o/r/issues/12')
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

			expect(await issue_fold_apply.apply(FOLD)).toBe('priority-failed')
		},
	)

	it.each([[EXISTING], [undefined]])('reports a re-read of %s as unverified', async (reread) => {
		reads(EXISTING, reread)

		expect(await issue_fold_apply.apply(FOLD)).toBe('unverified')
	})
})

describe('issue_fold_apply.apply before the write', () => {
	it('refuses to write a body that changed since the assessment', async () => {
		reads(`${EXISTING}\n\nA decision added later`)

		expect(await issue_fold_apply.apply(FOLD)).toBe('changed')
		expect(issue_edit_body).not.toHaveBeenCalled()
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
