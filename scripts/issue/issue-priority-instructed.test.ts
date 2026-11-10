import { git_gh_command } from '#scripts/gh/git-gh-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIORITY_CRITICAL_LABEL, PRIORITY_HIGH_LABEL } from './issue-labels'
import { issue_priority_instructed } from './issue-priority-instructed'

// joshuafolkken/kit#6758, joshuafolkken/kit#7000: `--critical|--high|--normal` applies a person's
// instruction with a reason comment, whatever the body declares, and leaves one priority label.

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		issue_get_labels_and_body: vi.fn(),
		issue_add_label: vi.fn(),
		issue_clear_label: vi.fn(),
		issue_try_comment: vi.fn(),
	},
}))

const ISSUE_NUMBER = '6707'
const REASON = 'the person asked to change it'
const mocked_read = vi.mocked(git_gh_command.issue_get_labels_and_body)
const mocked_add = vi.mocked(git_gh_command.issue_add_label)
const mocked_clear = vi.mocked(git_gh_command.issue_clear_label)
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
	mocked_add.mockResolvedValue(true)
	mocked_clear.mockResolvedValue(true)
	mocked_comment.mockResolvedValue(true)
})

describe('issue_priority_instructed.apply', () => {
	it('labels an undeclared issue critical and comments the reason', async () => {
		serve('bug')

		await expect(issue_priority_instructed.apply(ISSUE_NUMBER, 'critical', REASON)).resolves.toBe(
			'raised',
		)
		expect(mocked_add).toHaveBeenCalledWith(ISSUE_NUMBER, PRIORITY_CRITICAL_LABEL)
		expect(mocked_clear).not.toHaveBeenCalled()
		expect(mocked_comment).toHaveBeenCalledWith(
			ISSUE_NUMBER,
			expect.stringMatching(/a person's instruction[\s\S]*Reason: the person asked/u),
		)
	})

	it('takes priority:high off when raising a high issue to critical', async () => {
		serve('bug', PRIORITY_HIGH_LABEL)

		await expect(issue_priority_instructed.apply(ISSUE_NUMBER, 'critical', REASON)).resolves.toBe(
			'raised',
		)
		expect(mocked_add).toHaveBeenCalledExactlyOnceWith(ISSUE_NUMBER, PRIORITY_CRITICAL_LABEL)
		expect(mocked_clear).toHaveBeenCalledExactlyOnceWith(ISSUE_NUMBER, PRIORITY_HIGH_LABEL)
	})
})

describe('issue_priority_instructed.apply lowering', () => {
	it('lowers a critical issue to high, replacing the label', async () => {
		serve('bug', PRIORITY_CRITICAL_LABEL)

		await expect(issue_priority_instructed.apply(ISSUE_NUMBER, 'high', REASON)).resolves.toBe(
			'raised',
		)
		expect(mocked_add).toHaveBeenCalledExactlyOnceWith(ISSUE_NUMBER, PRIORITY_HIGH_LABEL)
		expect(mocked_clear).toHaveBeenCalledExactlyOnceWith(ISSUE_NUMBER, PRIORITY_CRITICAL_LABEL)
	})

	it('lowers to normal by taking every priority label off, with the reason comment', async () => {
		serve('bug', PRIORITY_HIGH_LABEL, PRIORITY_CRITICAL_LABEL)

		await expect(issue_priority_instructed.apply(ISSUE_NUMBER, 'normal', REASON)).resolves.toBe(
			'raised',
		)
		expect(mocked_add).not.toHaveBeenCalled()
		expect(mocked_clear.mock.calls).toStrictEqual([
			[ISSUE_NUMBER, PRIORITY_CRITICAL_LABEL],
			[ISSUE_NUMBER, PRIORITY_HIGH_LABEL],
		])
		expect(mocked_comment).toHaveBeenCalledWith(
			ISSUE_NUMBER,
			expect.stringContaining('Removed the priority labels'),
		)
	})
})

describe('issue_priority_instructed.apply without a change', () => {
	it.each([
		['critical', [PRIORITY_CRITICAL_LABEL]],
		['high', [PRIORITY_HIGH_LABEL]],
		['normal', []],
	] as const)('leaves an issue already at %s as it is, with no comment', async (level, labels) => {
		serve('bug', ...labels)

		await expect(issue_priority_instructed.apply(ISSUE_NUMBER, level, REASON)).resolves.toBe(
			'labelled',
		)
		expect(mocked_add).not.toHaveBeenCalled()
		expect(mocked_clear).not.toHaveBeenCalled()
		expect(mocked_comment).not.toHaveBeenCalled()
	})
})

describe('issue_priority_instructed.apply on a failure', () => {
	it('answers failed when the label fails after the comment, removing nothing', async () => {
		serve('bug', PRIORITY_HIGH_LABEL)
		mocked_add.mockResolvedValue(false)

		await expect(issue_priority_instructed.apply(ISSUE_NUMBER, 'critical', REASON)).resolves.toBe(
			'failed',
		)
		expect(mocked_comment).toHaveBeenCalled()
		expect(mocked_clear).not.toHaveBeenCalled()
	})

	it('answers failed when an old label stays on', async () => {
		serve('bug', PRIORITY_HIGH_LABEL)
		mocked_clear.mockResolvedValue(false)

		await expect(issue_priority_instructed.apply(ISSUE_NUMBER, 'critical', REASON)).resolves.toBe(
			'failed',
		)
	})

	it('answers failed without labelling when the comment fails, so a retry still comments', async () => {
		serve('bug')
		mocked_comment.mockResolvedValue(false)

		await expect(issue_priority_instructed.apply(ISSUE_NUMBER, 'critical', REASON)).resolves.toBe(
			'failed',
		)
		expect(mocked_add).not.toHaveBeenCalled()
	})

	it('answers unreadable and writes nothing when the issue cannot be read', async () => {
		mocked_read.mockResolvedValue(undefined)

		await expect(issue_priority_instructed.apply(ISSUE_NUMBER, 'critical', REASON)).resolves.toBe(
			'unreadable',
		)
		expect(mocked_add).not.toHaveBeenCalled()
		expect(mocked_comment).not.toHaveBeenCalled()
	})
})
