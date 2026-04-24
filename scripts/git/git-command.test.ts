import { describe, expect, it, vi } from 'vitest'

const git_config = vi.hoisted(() => ({ binary: '' }))

vi.mock('./constants', () => ({
	git_utilities: {
		get_git_command: () => git_config.binary,
		get_git_command_for_spawn: () => git_config.binary,
	},
}))

const VALID_GIT_BINARY = '/usr/bin/git'
const INVALID_GIT_BINARY = '/no-such-git-binary'
const PACKAGE_JSON = 'package.json'
const SUCCEEDS_TEST = 'returns a string when git succeeds'
const PROPAGATES_ERRORS_TEST = 'propagates errors instead of returning empty string'

describe('git_command.diff_cached', () => {
	it(SUCCEEDS_TEST, async () => {
		const { git_command } = await import('./git-command')

		git_config.binary = VALID_GIT_BINARY

		const result = await git_command.diff_cached(PACKAGE_JSON)

		expect(result).toStrictEqual(expect.any(String))
	})

	it(PROPAGATES_ERRORS_TEST, async () => {
		const { git_command } = await import('./git-command')

		git_config.binary = INVALID_GIT_BINARY

		await expect(git_command.diff_cached(PACKAGE_JSON)).rejects.toThrow()
	})
})

describe('git_command.diff_main', () => {
	it(SUCCEEDS_TEST, async () => {
		const { git_command } = await import('./git-command')

		git_config.binary = VALID_GIT_BINARY

		const result = await git_command.diff_main(PACKAGE_JSON)

		expect(result).toStrictEqual(expect.any(String))
	})

	it(PROPAGATES_ERRORS_TEST, async () => {
		const { git_command } = await import('./git-command')

		git_config.binary = INVALID_GIT_BINARY

		await expect(git_command.diff_main(PACKAGE_JSON)).rejects.toThrow()
	})
})
