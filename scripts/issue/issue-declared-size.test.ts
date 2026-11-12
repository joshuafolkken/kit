import { git_gh_command } from '#scripts/gh/git-gh-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_declared_size } from './issue-declared-size'

// joshuafolkken/kit#6206: the declared size the split notice's bar grows from, read off the Issue body.

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_get_body_classified: vi.fn() },
}))

const body_read = vi.mocked(git_gh_command.issue_get_body_classified)

beforeEach(() => {
	vi.resetAllMocks()
})

describe('issue_declared_size.read', () => {
	it('reads the declared files and lines off the body', async () => {
		body_read.mockResolvedValue({
			kind: 'read',
			text: '## 背景\n- 規模見積もり: 約 3 ファイル / 40 行（テスト除く）',
		})

		expect(await issue_declared_size.read('6206')).toEqual({ files: 3, lines: 40 })
	})

	it('is undefined for a body with no estimate', async () => {
		body_read.mockResolvedValue({ kind: 'read', text: '## 背景\n- 種別: 非不具合' })

		expect(await issue_declared_size.read('6206')).toBeUndefined()
	})

	it('is undefined for an empty body', async () => {
		body_read.mockResolvedValue({ kind: 'read', text: undefined })

		expect(await issue_declared_size.read('6206')).toBeUndefined()
	})

	it('throws for an unreadable body', async () => {
		body_read.mockResolvedValue({ kind: 'unreadable', reason: 'unreachable', status: 429 })

		await expect(issue_declared_size.read('6206')).rejects.toThrow('unreadable')
	})

	it('throws for a missing issue', async () => {
		body_read.mockResolvedValue({ kind: 'missing' })

		await expect(issue_declared_size.read('6206')).rejects.toThrow('missing')
	})
})
