import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./git/git-command', () => ({
	git_command: { branch: vi.fn(), get_default_branch: vi.fn() },
}))

const { git_command } = await import('./git/git-command')
const mocked_branch = vi.mocked(git_command.branch)
const mocked_get_default_branch = vi.mocked(git_command.get_default_branch)

mocked_branch.mockResolvedValue('feature-branch')
mocked_get_default_branch.mockResolvedValue('main')

const { check_main_branch } = await import('./prevent-main-commit')

beforeEach(() => {
	vi.clearAllMocks()
	mocked_get_default_branch.mockResolvedValue('main')
})

describe('check_main_branch', () => {
	const FEATURE_BRANCH = '123-some-feature'
	const NOT_ALLOWED_MSG = 'not allowed'

	it('returns failure result when on main branch', async () => {
		mocked_branch.mockResolvedValue('main')

		const result = await check_main_branch()

		expect(result.success).toBe(false)
		expect(result.message).toContain(NOT_ALLOWED_MSG)
	})

	it('returns success result when on a feature branch', async () => {
		mocked_branch.mockResolvedValue(FEATURE_BRANCH)

		const result = await check_main_branch()

		expect(result.success).toBe(true)
		expect(result.message).toContain(FEATURE_BRANCH)
	})

	it('returns failure result when on non-main default branch', async () => {
		mocked_branch.mockResolvedValue('develop')
		mocked_get_default_branch.mockResolvedValue('develop')

		const result = await check_main_branch()

		expect(result.success).toBe(false)
		expect(result.message).toContain(NOT_ALLOWED_MSG)
	})
})
