import { COMMAND_TIMEOUT_MS, GIT_TIMEOUT_MS, SUITE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { start_exec } from './start-exec'

vi.mock(import('execa'), async (import_original) => ({
	...(await import_original()),
	execaSync: vi.fn(),
}))

const mocked_execa = vi.mocked(execaSync)
const ROOT = '/work/my-site'

function result(exit_code: number | undefined): ReturnType<typeof execaSync> {
	const value: unknown = { exitCode: exit_code, stdout: '' }

	return value as ReturnType<typeof execaSync>
}

function last_options(): Record<string, unknown> {
	const call: ReadonlyArray<unknown> = mocked_execa.mock.calls.at(-1) ?? []
	const options = call.at(2)

	return typeof options === 'object' && options !== null ? { ...options } : {}
}

beforeEach(() => {
	mocked_execa.mockReset()
	mocked_execa.mockReturnValue(result(0))
})

describe('the git calls josh start makes', () => {
	it('bounds a read by the git budget, in the root', () => {
		start_exec.git_read(['symbolic-ref', '--short', 'HEAD'], ROOT)

		expect(last_options()).toMatchObject({ cwd: ROOT, timeout: GIT_TIMEOUT_MS })
	})

	it('bounds a yes-or-no question by the git budget', () => {
		start_exec.git_succeeds(['rev-parse', '--verify', '--quiet', 'HEAD'], ROOT)

		expect(last_options()).toMatchObject({ cwd: ROOT, timeout: GIT_TIMEOUT_MS })
	})

	it('bounds a write, which can fire the project hooks, by the suite budget and shows its output', () => {
		start_exec.git_run(['push', '--set-upstream', 'origin', 'setup'], ROOT)

		expect(last_options()).toMatchObject({ timeout: SUITE_TIMEOUT_MS, stdio: 'inherit' })
	})

	it('stops the step when a write exits non-zero', () => {
		mocked_execa.mockReturnValue(result(1))

		expect(() => {
			start_exec.git_run(['push'], ROOT)
		}).toThrow('git push exited with 1')
	})

	it('stops the step when a write never finished', () => {
		mocked_execa.mockReturnValue(result(undefined))

		expect(() => {
			start_exec.git_run(['push'], ROOT)
		}).toThrow('git push did not finish')
	})
})

describe('the gh calls josh start makes', () => {
	it('bounds the install and sign-in probes by the command budget', () => {
		start_exec.is_gh_installed(ROOT)

		expect(last_options()).toMatchObject({ cwd: ROOT, timeout: COMMAND_TIMEOUT_MS })

		start_exec.is_gh_signed_in(ROOT)

		expect(last_options()).toMatchObject({ cwd: ROOT, timeout: COMMAND_TIMEOUT_MS })
	})

	it('answers a failed probe as not ready', () => {
		mocked_execa.mockReturnValue(result(1))

		expect(start_exec.is_gh_installed(ROOT)).toBe(false)
		expect(start_exec.is_gh_signed_in(ROOT)).toBe(false)
	})

	it('bounds the repository creation, which pushes, by the suite budget', () => {
		start_exec.create_github_repository('my-site', 'private', ROOT)

		expect(mocked_execa.mock.calls.at(-1)?.[1]).toStrictEqual([
			'repo',
			'create',
			'my-site',
			'--private',
			'--source',
			'.',
			'--remote',
			'origin',
			'--push',
		])
		expect(last_options()).toMatchObject({ cwd: ROOT, timeout: SUITE_TIMEOUT_MS })
	})
})
