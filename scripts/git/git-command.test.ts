import { beforeEach, describe, expect, it, vi } from 'vitest'

const UPSTREAM_NOT_SET_EXIT_CODE = 128

const execa_mock = vi.hoisted(() => {
	const UPSTREAM_NOT_SET = 128
	const state = {
		should_fail: false as boolean,
		stdout: '',
		fail_plain_push: false as boolean,
		plain_push_exit_code: UPSTREAM_NOT_SET,
	}

	async function mock_execa(_cmd: string, arguments_: Array<string>): Promise<{ stdout: string }> {
		const is_bare_push = arguments_[0] === 'push' && !arguments_.includes('--set-upstream')

		if (state.fail_plain_push && is_bare_push) {
			throw Object.assign(new Error('bare push rejected'), { exitCode: state.plain_push_exit_code })
		}

		if (state.should_fail) throw new Error('Command failed')

		return await Promise.resolve({ stdout: state.stdout })
	}

	return { state, mock_execa }
})

vi.mock('execa', () => ({
	execa: execa_mock.mock_execa,
}))

const PACKAGE_JSON = 'package.json'
const DIFF_OUTPUT = 'diff output'
const SUCCEEDS_TEST = 'returns a string when git succeeds'
const PROPAGATES_ERRORS_TEST = 'propagates errors instead of returning empty string'

beforeEach(() => {
	execa_mock.state.should_fail = false
	execa_mock.state.stdout = ''
	execa_mock.state.fail_plain_push = false
	execa_mock.state.plain_push_exit_code = UPSTREAM_NOT_SET_EXIT_CODE
})

describe('git_command.diff_cached', () => {
	it(SUCCEEDS_TEST, async () => {
		execa_mock.state.stdout = DIFF_OUTPUT

		const { git_command } = await import('./git-command')
		const result = await git_command.diff_cached(PACKAGE_JSON)

		expect(result).toStrictEqual(expect.any(String))
	})

	it(PROPAGATES_ERRORS_TEST, async () => {
		execa_mock.state.should_fail = true

		const { git_command } = await import('./git-command')

		await expect(git_command.diff_cached(PACKAGE_JSON)).rejects.toThrow()
	})
})

describe('git_command.diff_main', () => {
	it(SUCCEEDS_TEST, async () => {
		execa_mock.state.stdout = DIFF_OUTPUT

		const { git_command } = await import('./git-command')
		const result = await git_command.diff_main(PACKAGE_JSON)

		expect(result).toStrictEqual(expect.any(String))
	})

	it(PROPAGATES_ERRORS_TEST, async () => {
		execa_mock.state.should_fail = true

		const { git_command } = await import('./git-command')

		await expect(git_command.diff_main(PACKAGE_JSON)).rejects.toThrow()
	})
})

const SYMBOLIC_REF_MAIN = 'refs/remotes/origin/main'
const NON_PREFIX_OUTPUT = 'something-else'

describe('git_command.get_default_branch', () => {
	it('returns branch name parsed from symbolic ref output', async () => {
		execa_mock.state.stdout = SYMBOLIC_REF_MAIN

		const { git_command } = await import('./git-command')
		const result = await git_command.get_default_branch()

		expect(result).toBe('main')
	})

	it('returns main when symbolic ref command fails', async () => {
		execa_mock.state.should_fail = true

		const { git_command } = await import('./git-command')
		const result = await git_command.get_default_branch()

		expect(result).toBe('main')
	})

	it('returns main when output does not start with expected prefix', async () => {
		execa_mock.state.stdout = NON_PREFIX_OUTPUT

		const { git_command } = await import('./git-command')
		const result = await git_command.get_default_branch()

		expect(result).toBe('main')
	})
})

describe('git_command.push', () => {
	it('falls back to --set-upstream when push fails with exit code 128', async () => {
		execa_mock.state.fail_plain_push = true
		execa_mock.state.stdout = 'feature-branch'

		const { git_command } = await import('./git-command')

		await expect(git_command.push()).resolves.toBeUndefined()
	})

	it('rethrows the wrapped error when the bare push fails with a non-128 exit code', async () => {
		const NON_UPSTREAM_EXIT_CODE = 1

		execa_mock.state.fail_plain_push = true
		execa_mock.state.plain_push_exit_code = NON_UPSTREAM_EXIT_CODE

		const { git_command } = await import('./git-command')

		await expect(git_command.push()).rejects.toThrow('exited with code 1')
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
