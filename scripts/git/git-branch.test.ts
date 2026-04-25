import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_branch } from './git-branch'

vi.mock('./animation-helpers', () => ({
	animation_helpers: {
		execute_with_animation: vi
			.fn()
			.mockImplementation(
				async (_message: string, action: () => Promise<unknown>, _options: unknown) =>
					await action(),
			),
	},
}))

vi.mock('./git-command', () => ({
	git_command: {
		branch: vi.fn(),
		checkout_b: vi.fn(),
		checkout: vi.fn(),
		branch_exists: vi.fn(),
		pull: vi.fn(),
		get_default_branch: vi.fn(),
	},
}))

vi.mock('./git-error', () => ({
	git_error: {
		display_branch_mismatch_error: vi.fn(),
	},
}))

const { git_command } = await import('./git-command')
const { git_error } = await import('./git-error')
const mocked_branch_exists = vi.mocked(git_command.branch_exists)
const mocked_checkout = vi.mocked(git_command.checkout)
const mocked_checkout_b = vi.mocked(git_command.checkout_b)
const mocked_pull = vi.mocked(git_command.pull)
const mocked_get_default_branch = vi.mocked(git_command.get_default_branch)
const mocked_display_error = vi.mocked(git_error.display_branch_mismatch_error)

const TARGET_BRANCH = 'feature-branch'
const WRONG_BRANCH = 'wrong-branch'
const SAME_PREFIX_CURRENT = '42-short-name'
const ISSUE_42_BRANCH = '42-some-feature'
const ISSUE_99_BRANCH = '99-other-feature'
const NO_PREFIX_BRANCH = 'feature-no-number'

beforeEach(() => {
	vi.clearAllMocks()
	mocked_get_default_branch.mockResolvedValue('main')
})

describe('git_branch.check_and_create_branch — from main', () => {
	it('switches to existing branch when on main and target branch exists', async () => {
		mocked_branch_exists.mockResolvedValue(true)
		mocked_checkout.mockResolvedValue('')
		const result = await git_branch.check_and_create_branch('main', TARGET_BRANCH)

		expect(mocked_checkout).toHaveBeenCalledWith(TARGET_BRANCH)
		expect(mocked_checkout_b).not.toHaveBeenCalled()
		expect(result).toBe(TARGET_BRANCH)
	})

	it('creates new branch when on main and target branch does not exist', async () => {
		mocked_branch_exists.mockResolvedValue(false)
		mocked_checkout_b.mockResolvedValue('')
		const result = await git_branch.check_and_create_branch('main', TARGET_BRANCH)

		expect(mocked_checkout_b).toHaveBeenCalledWith(TARGET_BRANCH)
		expect(mocked_checkout).not.toHaveBeenCalled()
		expect(result).toBe(TARGET_BRANCH)
	})

	it('always pulls latest when on main', async () => {
		mocked_branch_exists.mockResolvedValue(false)
		mocked_checkout_b.mockResolvedValue('')
		await git_branch.check_and_create_branch('main', TARGET_BRANCH)

		expect(mocked_pull).toHaveBeenCalledOnce()
	})
})

describe('git_branch.check_and_create_branch — from correct branch', () => {
	it('returns target branch name when already on it', async () => {
		const result = await git_branch.check_and_create_branch(TARGET_BRANCH, TARGET_BRANCH)

		expect(mocked_display_error).not.toHaveBeenCalled()
		expect(mocked_checkout).not.toHaveBeenCalled()
		expect(mocked_checkout_b).not.toHaveBeenCalled()
		expect(result).toBe(TARGET_BRANCH)
	})
})

describe('git_branch.check_and_create_branch — from wrong branch', () => {
	it('calls display_branch_mismatch_error when on wrong branch', async () => {
		await git_branch.check_and_create_branch(WRONG_BRANCH, TARGET_BRANCH)

		expect(mocked_display_error).toHaveBeenCalledWith(WRONG_BRANCH, TARGET_BRANCH)
	})
})

describe('git_branch.check_and_create_branch — same issue prefix', () => {
	it('returns current branch without error when prefix matches', async () => {
		const result = await git_branch.check_and_create_branch(
			SAME_PREFIX_CURRENT,
			'42-very-long-name-from-full-title',
		)

		expect(mocked_display_error).not.toHaveBeenCalled()
		expect(result).toBe(SAME_PREFIX_CURRENT)
	})

	it('calls display_branch_mismatch_error when issue numbers differ', async () => {
		await git_branch.check_and_create_branch(ISSUE_42_BRANCH, ISSUE_99_BRANCH)

		expect(mocked_display_error).toHaveBeenCalledWith(ISSUE_42_BRANCH, ISSUE_99_BRANCH)
	})

	it('calls display_branch_mismatch_error when current branch has no issue prefix', async () => {
		await git_branch.check_and_create_branch(NO_PREFIX_BRANCH, ISSUE_42_BRANCH)

		expect(mocked_display_error).toHaveBeenCalledWith(NO_PREFIX_BRANCH, ISSUE_42_BRANCH)
	})
})

describe('git_branch.check_and_create_branch — from non-main default branch', () => {
	it('creates branch when on non-main default branch', async () => {
		mocked_get_default_branch.mockResolvedValue('develop')
		mocked_branch_exists.mockResolvedValue(false)
		mocked_checkout_b.mockResolvedValue('')
		await git_branch.check_and_create_branch('develop', TARGET_BRANCH)

		expect(mocked_checkout_b).toHaveBeenCalledWith(TARGET_BRANCH)
	})
})
