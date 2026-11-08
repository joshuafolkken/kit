import { git_gh_command } from '#scripts/gh/git-gh-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIORITY_CRITICAL_LABEL } from './issue-labels'
import { issue_priority_critical } from './issue-priority-critical'

// joshuafolkken/kit#6758: `--critical` applies a person's instruction with a reason comment,
// whatever the body declares.

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		issue_get_labels_and_body: vi.fn(),
		issue_add_label: vi.fn(),
		issue_try_comment: vi.fn(),
	},
}))

const ISSUE_NUMBER = '6707'
const REASON = 'the person asked to make it critical'
const mocked_read = vi.mocked(git_gh_command.issue_get_labels_and_body)
const mocked_add = vi.mocked(git_gh_command.issue_add_label)
const mocked_comment = vi.mocked(git_gh_command.issue_try_comment)

function serve(...labels: ReadonlyArray<string>): void {
	mocked_read.mockResolvedValue(
		JSON.stringify({
			labels: labels.map((name) => ({ name })),
			body: '## 背景\n\n- 種別: 不具合\n',
		}),
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	mocked_add.mockResolvedValue(true)
	mocked_comment.mockResolvedValue(true)
})

describe('issue_priority_critical.apply', () => {
	it('labels an undeclared issue critical and comments the reason', async () => {
		serve('bug')

		await expect(issue_priority_critical.apply(ISSUE_NUMBER, REASON)).resolves.toBe('raised')
		expect(mocked_add).toHaveBeenCalledWith(ISSUE_NUMBER, PRIORITY_CRITICAL_LABEL)
		expect(mocked_comment).toHaveBeenCalledWith(ISSUE_NUMBER, expect.stringContaining(REASON))
		expect(mocked_comment).toHaveBeenCalledWith(
			ISSUE_NUMBER,
			expect.stringContaining("a person's instruction"),
		)
	})

	it('leaves an issue already critical as it is, with no comment', async () => {
		serve('bug', PRIORITY_CRITICAL_LABEL)

		await expect(issue_priority_critical.apply(ISSUE_NUMBER, REASON)).resolves.toBe('labelled')
		expect(mocked_add).not.toHaveBeenCalled()
		expect(mocked_comment).not.toHaveBeenCalled()
	})

	it('answers failed without commenting when the label fails', async () => {
		serve('bug')
		mocked_add.mockResolvedValue(false)

		await expect(issue_priority_critical.apply(ISSUE_NUMBER, REASON)).resolves.toBe('failed')
		expect(mocked_comment).not.toHaveBeenCalled()
	})

	it('answers failed when the comment fails', async () => {
		serve('bug')
		mocked_comment.mockResolvedValue(false)

		await expect(issue_priority_critical.apply(ISSUE_NUMBER, REASON)).resolves.toBe('failed')
	})

	it('answers unreadable and writes nothing when the issue cannot be read', async () => {
		mocked_read.mockResolvedValue(undefined)

		await expect(issue_priority_critical.apply(ISSUE_NUMBER, REASON)).resolves.toBe('unreadable')
		expect(mocked_add).not.toHaveBeenCalled()
		expect(mocked_comment).not.toHaveBeenCalled()
	})
})
