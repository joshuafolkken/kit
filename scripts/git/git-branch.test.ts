import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_branch } from './git-branch'
import { BranchMismatchError } from './git-error'

vi.mock('#scripts/lib/animation-helpers', () => ({
	animation_helpers: {
		execute_with_animation: vi
			.fn()
			.mockImplementation(
				async (_message: string, action: () => Promise<unknown>, _options: unknown) =>
					await action(),
			),
	},
	create_git_operation_config: vi.fn().mockReturnValue({}),
}))

vi.mock('./git-command', () => ({
	git_command: {
		branch: vi.fn(),
		checkout_b: vi.fn(),
		checkout: vi.fn(),
		branch_exists: vi.fn(),
		pull_fast_forward: vi.fn(),
		get_default_branch: vi.fn(),
	},
}))

const { git_command } = await import('./git-command')
const mocked_branch_exists = vi.mocked(git_command.branch_exists)
const mocked_checkout = vi.mocked(git_command.checkout)
const mocked_checkout_b = vi.mocked(git_command.checkout_b)
const mocked_pull = vi.mocked(git_command.pull_fast_forward)
const mocked_get_default_branch = vi.mocked(git_command.get_default_branch)

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

		expect(mocked_checkout).not.toHaveBeenCalled()
		expect(mocked_checkout_b).not.toHaveBeenCalled()
		expect(result).toBe(TARGET_BRANCH)
	})
})

// joshuafolkken/kit#2985: a mismatch is thrown as a typed error for the CLI entry to render, never
// ended with `process.exit`, so every `finally` above the call still runs.
describe('git_branch.check_and_create_branch — a mismatched branch', () => {
	it.each([
		['on a wrong branch', WRONG_BRANCH, TARGET_BRANCH],
		['issue numbers differ', ISSUE_42_BRANCH, ISSUE_99_BRANCH],
		['current branch has no issue prefix', NO_PREFIX_BRANCH, ISSUE_42_BRANCH],
	])('rejects with a BranchMismatchError when %s', async (_case, current, target) => {
		const exit_spy = vi.spyOn(process, 'exit')
		const rejection = git_branch.check_and_create_branch(current, target)

		await expect(rejection).rejects.toThrow(BranchMismatchError)
		await expect(rejection).rejects.toMatchObject({
			current_branch: current,
			target_branch_name: target,
		})
		expect(exit_spy).not.toHaveBeenCalled()
		exit_spy.mockRestore()
	})
})

describe('git_branch.check_and_create_branch — same issue prefix', () => {
	it('returns current branch without error when prefix matches', async () => {
		const result = await git_branch.check_and_create_branch(
			SAME_PREFIX_CURRENT,
			'42-very-long-name-from-full-title',
		)

		expect(result).toBe(SAME_PREFIX_CURRENT)
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

describe('git_branch.is_mismatch', () => {
	it('is false on the default branch, where the target is still to be created', () => {
		expect(git_branch.is_mismatch('main', TARGET_BRANCH, 'main')).toBe(false)
	})

	it('is false on the target branch itself', () => {
		expect(git_branch.is_mismatch(TARGET_BRANCH, TARGET_BRANCH, 'main')).toBe(false)
	})

	it('is false for a branch sharing the issue prefix', () => {
		expect(git_branch.is_mismatch(SAME_PREFIX_CURRENT, ISSUE_42_BRANCH, 'main')).toBe(false)
	})

	it('is true for a branch with a different or no issue prefix', () => {
		expect(git_branch.is_mismatch(ISSUE_99_BRANCH, ISSUE_42_BRANCH, 'main')).toBe(true)
		expect(git_branch.is_mismatch(NO_PREFIX_BRANCH, ISSUE_42_BRANCH, 'main')).toBe(true)
	})
})

// joshuafolkken/kit#2919: the ledger writer names its file from this, so it lives in a shipped module.
describe('git_branch.issue_from_branch', () => {
	it('reads the leading issue number of a lane or topic branch', () => {
		expect(git_branch.issue_from_branch('2919-lane')).toBe(2919)
		expect(git_branch.issue_from_branch(ISSUE_42_BRANCH)).toBe(42)
	})

	it('reads nothing from a branch without a leading number', () => {
		expect(git_branch.issue_from_branch('main')).toBeUndefined()
		expect(git_branch.issue_from_branch(NO_PREFIX_BRANCH)).toBeUndefined()
	})
})
