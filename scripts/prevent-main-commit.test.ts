import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./git/git-command', () => ({
	git_command: { branch: vi.fn() },
}))

const { git_command } = await import('./git/git-command')
const mocked_branch = vi.mocked(git_command.branch)

mocked_branch.mockResolvedValue('feature-branch')

const { check_main_branch } = await import('./prevent-main-commit')

beforeEach(() => {
	vi.clearAllMocks()
})

describe('check_main_branch', () => {
	const FEATURE_BRANCH = '123-some-feature'

	it('returns failure result when on main branch', async () => {
		mocked_branch.mockResolvedValue('main')

		const result = await check_main_branch()

		expect(result.success).toBe(false)
		expect(result.message).toContain('not allowed')
	})

	it('returns success result when on a feature branch', async () => {
		mocked_branch.mockResolvedValue(FEATURE_BRANCH)

		const result = await check_main_branch()

		expect(result.success).toBe(true)
		expect(result.message).toContain(FEATURE_BRANCH)
	})
})
