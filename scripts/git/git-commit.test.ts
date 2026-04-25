import { beforeEach, describe, expect, it, vi } from 'vitest'

const COMMIT_MESSAGE = 'feat: add feature'
const COMMIT_ERROR = 'commit failed'

vi.mock('./animation-helpers', () => ({
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
		commit: vi.fn(),
	},
}))

const { git_commit } = await import('./git-commit')
const { git_command } = await import('./git-command')
const mocked_commit = vi.mocked(git_command.commit)

beforeEach(() => {
	vi.clearAllMocks()
})

describe('git_commit.commit', () => {
	it('calls git_command.commit with the provided message', async () => {
		await git_commit.commit(COMMIT_MESSAGE)

		expect(mocked_commit).toHaveBeenCalledWith(COMMIT_MESSAGE)
	})

	it('propagates errors from git_command.commit', async () => {
		mocked_commit.mockRejectedValueOnce(new Error(COMMIT_ERROR))

		await expect(git_commit.commit('bad commit')).rejects.toThrow(COMMIT_ERROR)
	})
})
