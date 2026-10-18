import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_park } from './issue-park'

const { add_label_mock, comment_mock } = vi.hoisted(() => ({
	add_label_mock: vi.fn<(issue: string, label: string) => Promise<boolean>>(),
	comment_mock: vi.fn<(issue: string, body: string) => Promise<boolean>>(),
}))

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_add_label: add_label_mock, issue_try_comment: comment_mock },
}))

const ISSUE = '4132'
const LABEL = 'needs-decision'
const BODY = 'Which option?'

beforeEach(() => {
	add_label_mock.mockReset().mockResolvedValue(true)
	comment_mock.mockReset().mockResolvedValue(true)
})

// joshuafolkken/kit#4132: `run:park`, `run:merge` and the ship relaunch cap share this one write.
describe('issue_park.apply', () => {
	it('applies the label and posts the comment', async () => {
		await expect(issue_park.apply(ISSUE, LABEL, BODY)).resolves.toStrictEqual({
			is_labelled: true,
			is_commented: true,
		})
		expect(add_label_mock).toHaveBeenCalledWith(ISSUE, LABEL)
		expect(comment_mock).toHaveBeenCalledWith(ISSUE, BODY)
	})

	// A comment on an issue whose label failed would explain a park that did not happen.
	it('posts no comment when the label fails', async () => {
		add_label_mock.mockResolvedValue(false)

		await expect(issue_park.apply(ISSUE, LABEL, BODY)).resolves.toStrictEqual({
			is_labelled: false,
			is_commented: false,
		})
		expect(comment_mock).not.toHaveBeenCalled()
	})

	it('reports a comment that failed', async () => {
		comment_mock.mockResolvedValue(false)

		await expect(issue_park.apply(ISSUE, LABEL, BODY)).resolves.toStrictEqual({
			is_labelled: true,
			is_commented: false,
		})
	})
})
