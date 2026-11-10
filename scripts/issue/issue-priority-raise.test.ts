import { git_gh_command } from '#scripts/gh/git-gh-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PRIORITY_CRITICAL_LABEL, PRIORITY_HIGH_LABEL } from './issue-labels'
import { issue_priority_raise } from './issue-priority-raise'

// joshuafolkken/kit#4960: a recurrence's appended cause-loss line raises an open issue's label;
// joshuafolkken/kit#6757: so does a priority declaration, up to priority:critical.

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		issue_get_labels_and_body: vi.fn(),
		issue_add_label: vi.fn(),
		issue_clear_label: vi.fn(),
	},
}))

const ISSUE_NUMBER = '4960'
const ENHANCEMENT = 'enhancement'
const mocked_read = vi.mocked(git_gh_command.issue_get_labels_and_body)
const mocked_add = vi.mocked(git_gh_command.issue_add_label)
const mocked_clear = vi.mocked(git_gh_command.issue_clear_label)

function body(...minutes: ReadonlyArray<string>): string {
	const lines = minutes.map((value) => `- 原因の損失: ${value} 分\n`).join('')

	return `## 背景\n\n- 種別: 非不具合\n${lines}\n## 期待効果\n`
}

function declared(line: string): string {
	return `## 背景\n\n- 種別: 非不具合\n${line}\n\n## 期待効果\n`
}

const URGENT = declared('- 優先度: 緊急（条件 1）')

function serve(text: string, ...labels: ReadonlyArray<string>): void {
	mocked_read.mockResolvedValue(
		JSON.stringify({ labels: labels.map((name) => ({ name })), body: text }),
	)
}

beforeEach(() => {
	mocked_add.mockResolvedValue(true)
	mocked_clear.mockResolvedValue(true)
})

describe('issue_priority_raise.raise', () => {
	it('applies priority:high once the summed losses reach 30 minutes', async () => {
		serve(body('16', '14'), ENHANCEMENT)

		await expect(issue_priority_raise.raise(ISSUE_NUMBER)).resolves.toBe('raised')
		expect(mocked_add).toHaveBeenCalledWith(ISSUE_NUMBER, PRIORITY_HIGH_LABEL)
	})

	it('applies nothing below 30 minutes', async () => {
		serve(body('16', '13'), ENHANCEMENT)

		await expect(issue_priority_raise.raise(ISSUE_NUMBER)).resolves.toBe('below')
		expect(mocked_add).not.toHaveBeenCalled()
	})

	it.each([[PRIORITY_HIGH_LABEL], [PRIORITY_CRITICAL_LABEL]])(
		'does nothing when the issue already carries %s',
		async (label) => {
			serve(body('45'), label)

			await expect(issue_priority_raise.raise(ISSUE_NUMBER)).resolves.toBe('labelled')
			expect(mocked_add).not.toHaveBeenCalled()
		},
	)

	it('answers unreadable when the issue cannot be read', async () => {
		mocked_read.mockResolvedValue(undefined)

		await expect(issue_priority_raise.raise(ISSUE_NUMBER)).resolves.toBe('unreadable')
	})

	it('answers failed when the label write is not applied', async () => {
		serve(body('30'))
		mocked_add.mockResolvedValue(false)

		await expect(issue_priority_raise.raise(ISSUE_NUMBER)).resolves.toBe('failed')
	})
})

describe('issue_priority_raise.raise on a declared priority', () => {
	it.each([
		['- 優先度: 緊急（条件 2）', PRIORITY_CRITICAL_LABEL],
		['- 優先度: 高（再発で 1 時間失った）', PRIORITY_HIGH_LABEL],
	])('applies the label of the declared %s', async (line, label) => {
		serve(declared(line), ENHANCEMENT)

		await expect(issue_priority_raise.raise(ISSUE_NUMBER)).resolves.toBe('raised')
		expect(mocked_add).toHaveBeenCalledWith(ISSUE_NUMBER, label)
	})

	it('replaces priority:high with priority:critical once the body declares urgent', async () => {
		serve(URGENT, PRIORITY_HIGH_LABEL)

		await expect(issue_priority_raise.raise(ISSUE_NUMBER)).resolves.toBe('raised')
		expect(mocked_add).toHaveBeenCalledWith(ISSUE_NUMBER, PRIORITY_CRITICAL_LABEL)
		expect(mocked_clear).toHaveBeenCalledExactlyOnceWith(ISSUE_NUMBER, PRIORITY_HIGH_LABEL)
	})

	it('answers failed when the lower label stays on', async () => {
		serve(URGENT, PRIORITY_HIGH_LABEL)
		mocked_clear.mockResolvedValue(false)

		await expect(issue_priority_raise.raise(ISSUE_NUMBER)).resolves.toBe('failed')
	})

	it('raises a normal declaration once appended losses reach the high floor', async () => {
		serve(declared('- 優先度: 通常\n- 原因の損失: 20 分\n- 原因の損失: 15 分'), ENHANCEMENT)

		await expect(issue_priority_raise.raise(ISSUE_NUMBER)).resolves.toBe('raised')
		expect(mocked_add).toHaveBeenCalledWith(ISSUE_NUMBER, PRIORITY_HIGH_LABEL)
	})

	it.each([['- 優先度: 通常'], ['- 優先度: 緊急']])(
		'applies nothing for the declaration %s',
		async (line) => {
			serve(declared(line), ENHANCEMENT)

			await expect(issue_priority_raise.raise(ISSUE_NUMBER)).resolves.toBe('below')
			expect(mocked_add).not.toHaveBeenCalled()
		},
	)
})
