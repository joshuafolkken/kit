import { describe, expect, it, vi } from 'vitest'

const exec_mock = vi.hoisted(() => {
	const state = { should_fail: false as boolean, stdout: '' }

	async function mock_exec_file_async(
		_cmd: string,
		_arguments: Array<string>,
	): Promise<{ stdout: string; stderr: string }> {
		if (state.should_fail) throw new Error('Command failed')

		return await Promise.resolve({ stdout: state.stdout, stderr: '' })
	}

	return { state, mock_exec_file_async }
})

vi.mock('node:util', () => ({
	promisify: () => exec_mock.mock_exec_file_async,
}))

const PACKAGE_JSON = 'package.json'
const DIFF_OUTPUT = 'diff output'
const SUCCEEDS_TEST = 'returns a string when git succeeds'
const PROPAGATES_ERRORS_TEST = 'propagates errors instead of returning empty string'

describe('git_command.diff_cached', () => {
	it(SUCCEEDS_TEST, async () => {
		exec_mock.state.should_fail = false
		exec_mock.state.stdout = DIFF_OUTPUT

		const { git_command } = await import('./git-command')
		const result = await git_command.diff_cached(PACKAGE_JSON)

		expect(result).toStrictEqual(expect.any(String))
	})

	it(PROPAGATES_ERRORS_TEST, async () => {
		exec_mock.state.should_fail = true

		const { git_command } = await import('./git-command')

		await expect(git_command.diff_cached(PACKAGE_JSON)).rejects.toThrow()
	})
})

describe('git_command.diff_main', () => {
	it(SUCCEEDS_TEST, async () => {
		exec_mock.state.should_fail = false
		exec_mock.state.stdout = DIFF_OUTPUT

		const { git_command } = await import('./git-command')
		const result = await git_command.diff_main(PACKAGE_JSON)

		expect(result).toStrictEqual(expect.any(String))
	})

	it(PROPAGATES_ERRORS_TEST, async () => {
		exec_mock.state.should_fail = true

		const { git_command } = await import('./git-command')

		await expect(git_command.diff_main(PACKAGE_JSON)).rejects.toThrow()
	})
})

const SYMBOLIC_REF_MAIN = 'refs/remotes/origin/main'
const NON_PREFIX_OUTPUT = 'something-else'

describe('git_command.get_default_branch', () => {
	it('returns branch name parsed from symbolic ref output', async () => {
		exec_mock.state.should_fail = false
		exec_mock.state.stdout = SYMBOLIC_REF_MAIN

		const { git_command } = await import('./git-command')
		const result = await git_command.get_default_branch()

		expect(result).toBe('main')
	})

	it('returns main when symbolic ref command fails', async () => {
		exec_mock.state.should_fail = true

		const { git_command } = await import('./git-command')
		const result = await git_command.get_default_branch()

		expect(result).toBe('main')
	})

	it('returns main when output does not start with expected prefix', async () => {
		exec_mock.state.should_fail = false
		exec_mock.state.stdout = NON_PREFIX_OUTPUT

		const { git_command } = await import('./git-command')
		const result = await git_command.get_default_branch()

		expect(result).toBe('main')
	})
})

describe('git_command.is_upstream_not_set_error', () => {
	const RETURNS_FALSE = 'returns false'
	const PUSH_FAILED = 'push failed'

	it('returns true for an Error with cause.exit_code of 128', async () => {
		const { git_command } = await import('./git-command')
		const error = new Error(PUSH_FAILED)

		error.cause = { exit_code: '128' }

		expect(git_command.is_upstream_not_set_error(error)).toBe(true)
	})

	it(`${RETURNS_FALSE} when cause.exit_code is not 128`, async () => {
		const { git_command } = await import('./git-command')
		const error = new Error(PUSH_FAILED)

		error.cause = { exit_code: '1' }

		expect(git_command.is_upstream_not_set_error(error)).toBe(false)
	})

	it(`${RETURNS_FALSE} for a plain Error without cause`, async () => {
		const { git_command } = await import('./git-command')

		expect(git_command.is_upstream_not_set_error(new Error('fail'))).toBe(false)
	})

	it(`${RETURNS_FALSE} for a non-Error value`, async () => {
		const { git_command } = await import('./git-command')

		expect(git_command.is_upstream_not_set_error('not an error')).toBe(false)
	})
})
