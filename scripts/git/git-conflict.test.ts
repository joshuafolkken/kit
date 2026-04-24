import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./git-gh-command', () => ({
	git_gh_command: {
		pr_view: vi.fn(),
	},
}))

const { git_gh_command } = await import('./git-gh-command')
const mocked_pr_view = vi.mocked(git_gh_command.pr_view)

const { git_conflict } = await import('./git-conflict')

const PROCESS_EXIT_CALLED = 'process.exit called'
const BRANCH_NAME = 'feature-branch'
const MERGE_STATE_CLEAN = 'CLEAN'

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(process, 'exit').mockImplementation(() => {
		throw new Error(PROCESS_EXIT_CALLED)
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('git_conflict.check_pr_status_for_errors — no conflicts', () => {
	it('returns false when pr_view returns empty string', async () => {
		mocked_pr_view.mockResolvedValue('')

		expect(await git_conflict.check_pr_status_for_errors(BRANCH_NAME)).toBe(false)
	})

	it('returns false when pr_view throws', async () => {
		mocked_pr_view.mockRejectedValue(new Error('not found'))

		expect(await git_conflict.check_pr_status_for_errors(BRANCH_NAME)).toBe(false)
	})

	it('returns false when PR JSON is invalid', async () => {
		mocked_pr_view.mockResolvedValue('not-valid-json')

		expect(await git_conflict.check_pr_status_for_errors(BRANCH_NAME)).toBe(false)
	})

	it('returns false when PR is mergeable with clean state', async () => {
		const pr_info = JSON.stringify({ mergeable: true, mergeStateStatus: MERGE_STATE_CLEAN })

		mocked_pr_view.mockResolvedValue(pr_info)

		expect(await git_conflict.check_pr_status_for_errors(BRANCH_NAME)).toBe(false)
	})
})

describe('git_conflict.check_pr_status_for_errors — conflicts detected', () => {
	it('calls process.exit when mergeable is CONFLICTING', async () => {
		const pr_info = JSON.stringify({
			mergeable: 'CONFLICTING',
			mergeStateStatus: MERGE_STATE_CLEAN,
		})

		mocked_pr_view.mockResolvedValue(pr_info)

		await expect(git_conflict.check_pr_status_for_errors(BRANCH_NAME)).rejects.toThrow(
			PROCESS_EXIT_CALLED,
		)
	})

	it('calls process.exit when mergeable is false', async () => {
		const pr_info = JSON.stringify({ mergeable: false, mergeStateStatus: MERGE_STATE_CLEAN })

		mocked_pr_view.mockResolvedValue(pr_info)

		await expect(git_conflict.check_pr_status_for_errors(BRANCH_NAME)).rejects.toThrow(
			PROCESS_EXIT_CALLED,
		)
	})

	it('calls process.exit when mergeStateStatus is dirty', async () => {
		mocked_pr_view.mockResolvedValue(JSON.stringify({ mergeable: true, mergeStateStatus: 'dirty' }))

		await expect(git_conflict.check_pr_status_for_errors(BRANCH_NAME)).rejects.toThrow(
			PROCESS_EXIT_CALLED,
		)
	})

	it('calls process.exit when mergeStateStatus is BLOCKED', async () => {
		mocked_pr_view.mockResolvedValue(
			JSON.stringify({ mergeable: true, mergeStateStatus: 'BLOCKED' }),
		)

		await expect(git_conflict.check_pr_status_for_errors(BRANCH_NAME)).rejects.toThrow(
			PROCESS_EXIT_CALLED,
		)
	})
})
