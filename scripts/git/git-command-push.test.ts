import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_command } from './git-command'

// `git_command.push`'s suite, apart from `git-command.test.ts` so that one stays under the file
// limit. The fake answers the bare push with the exit code a test sets, which is how the 128
// `--set-upstream` fallback is reached.
const execa_mock = vi.hoisted(() => {
	const UPSTREAM_NOT_SET = 128
	const SET_UPSTREAM = '--set-upstream'
	const state = {
		stdout: '',
		fail_plain_push: false as boolean,
		plain_push_exit_code: UPSTREAM_NOT_SET,
		last_arguments: [] as Array<string>,
	}

	async function mock_execa(_cmd: string, arguments_: Array<string>): Promise<{ stdout: string }> {
		state.last_arguments = [...arguments_]

		const is_bare_push = arguments_[0] === 'push' && !arguments_.includes(SET_UPSTREAM)

		if (is_bare_push && state.fail_plain_push) {
			throw Object.assign(new Error('bare push rejected'), {
				exitCode: state.plain_push_exit_code,
			})
		}

		return { stdout: state.stdout }
	}

	return { SET_UPSTREAM, UPSTREAM_NOT_SET, state, mock_execa }
})

vi.mock('execa', () => ({
	execa: execa_mock.mock_execa,
}))

const hook_mock = vi.hoisted(() => ({ run: vi.fn<() => Promise<boolean>>() }))

vi.mock('./git-pre-push-hook', () => ({ git_pre_push_hook: hook_mock }))

const FEATURE_BRANCH = 'feature-branch'
const HOOK_FAILURE = 'git hook exited with code 1'
const NO_VERIFY = '--no-verify'

beforeEach(() => {
	execa_mock.state.stdout = ''
	execa_mock.state.fail_plain_push = false
	execa_mock.state.plain_push_exit_code = execa_mock.UPSTREAM_NOT_SET
	execa_mock.state.last_arguments = []
	hook_mock.run.mockReset()
	hook_mock.run.mockResolvedValue(true)
})

describe('git_command.push', () => {
	it('falls back to --set-upstream when push fails with exit code 128', async () => {
		execa_mock.state.fail_plain_push = true
		execa_mock.state.stdout = FEATURE_BRANCH

		await expect(git_command.push()).resolves.toBeUndefined()
	})

	it('rethrows the wrapped error when the bare push fails with a non-128 exit code', async () => {
		const NON_UPSTREAM_EXIT_CODE = 1

		execa_mock.state.fail_plain_push = true
		execa_mock.state.plain_push_exit_code = NON_UPSTREAM_EXIT_CODE

		await expect(git_command.push()).rejects.toThrow('exited with code 1')
	})
})

// joshuafolkken/kit#3300: a hook run inside the bounded push was counted against the transfer budget,
// and the lefthook and vitest it started outlived the killed `git`, so the retry ran a second unit
// suite beside the first. The hook now runs once ahead, and every bounded transfer skips it.
describe('git_command.push runs the pre-push hook outside the push budget', () => {
	it('pushes with --no-verify once the hook has run ahead', async () => {
		await git_command.push()

		expect(execa_mock.state.last_arguments).toStrictEqual(['push', NO_VERIFY])
	})

	it('runs the hook once and keeps --no-verify when the push falls back to --set-upstream', async () => {
		execa_mock.state.fail_plain_push = true
		execa_mock.state.stdout = FEATURE_BRANCH

		await git_command.push()

		expect(hook_mock.run).toHaveBeenCalledOnce()
		expect(execa_mock.state.last_arguments).toStrictEqual([
			'push',
			NO_VERIFY,
			execa_mock.SET_UPSTREAM,
			'origin',
			FEATURE_BRANCH,
		])
	})

	it('leaves the hook to the push when this git cannot run it ahead', async () => {
		hook_mock.run.mockResolvedValue(false)

		await git_command.push()

		expect(execa_mock.state.last_arguments).toStrictEqual(['push'])
	})

	it('does not push when the pre-push hook fails', async () => {
		hook_mock.run.mockRejectedValue(new Error(HOOK_FAILURE))

		await expect(git_command.push()).rejects.toThrow(HOOK_FAILURE)
		expect(execa_mock.state.last_arguments).toStrictEqual([])
	})
})

describe('git_command.is_upstream_not_set_error', () => {
	const RETURNS_FALSE = 'returns false'
	const PUSH_FAILED = 'push failed'

	it('returns true for an Error with cause.exit_code of 128', () => {
		const error = new Error(PUSH_FAILED, { cause: { exit_code: '128' } })

		expect(git_command.is_upstream_not_set_error(error)).toBe(true)
	})

	it(`${RETURNS_FALSE} when cause.exit_code is not 128`, () => {
		const error = new Error(PUSH_FAILED, { cause: { exit_code: '1' } })

		expect(git_command.is_upstream_not_set_error(error)).toBe(false)
	})

	it(`${RETURNS_FALSE} for a plain Error without cause`, () => {
		expect(git_command.is_upstream_not_set_error(new Error('fail'))).toBe(false)
	})

	it(`${RETURNS_FALSE} for a non-Error value`, () => {
		expect(git_command.is_upstream_not_set_error('not an error')).toBe(false)
	})
})
