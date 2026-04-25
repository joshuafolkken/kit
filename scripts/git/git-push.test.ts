import { beforeEach, describe, expect, it, vi } from 'vitest'

const PUSH_ERROR = 'push failed'

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
		push: vi.fn(),
	},
}))

const { git_push } = await import('./git-push')
const { git_command } = await import('./git-command')
const { animation_helpers } = await import('./animation-helpers')
const mocked_push = vi.mocked(git_command.push)
const mocked_execute = vi.mocked(animation_helpers.execute_with_animation)

beforeEach(() => {
	vi.clearAllMocks()
})

describe('git_push.push', () => {
	it('calls git_command.push via animation wrapper', async () => {
		await git_push.push()

		expect(mocked_execute).toHaveBeenCalledOnce()
		expect(mocked_push).toHaveBeenCalledOnce()
	})

	it('propagates errors from git_command.push', async () => {
		mocked_push.mockRejectedValueOnce(new Error(PUSH_ERROR))

		await expect(git_push.push()).rejects.toThrow(PUSH_ERROR)
	})
})
