import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { init_install } from './init-install'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const mocked_execa = vi.mocked(execaSync)
const ROOT = '/work/site'
const PNPM_INSTALL = 'pnpm install'
const STATIC_PROFILE = ['--profile', 'static']
const { NO_INSTALL_FLAG } = init_install

function result(exit_code: number): ReturnType<typeof execaSync> {
	const value: unknown = { exitCode: exit_code }

	return value as ReturnType<typeof execaSync>
}

function commands(): Array<string> {
	return mocked_execa.mock.calls.map((call) => {
		const args: ReadonlyArray<unknown> = Array.isArray(call[1]) ? call[1] : []

		return [call[0], ...args].join(' ')
	})
}

beforeEach(() => {
	mocked_execa.mockReset()
	mocked_execa.mockReturnValue(result(0))
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

describe('run_post_init_steps', () => {
	it('installs the dependencies, then formats the project', () => {
		expect(init_install.run_post_init_steps(ROOT)).toBeUndefined()
		expect(commands()).toStrictEqual([PNPM_INSTALL, 'pnpm exec josh format'])
	})

	it('runs every step in the project root', () => {
		init_install.run_post_init_steps(ROOT)

		// The mock is typed from execa's two-argument overload, so the options argument is read untyped.
		const { calls }: { calls: ReadonlyArray<ReadonlyArray<unknown>> } = mocked_execa.mock

		for (const call of calls) expect(call[2]).toMatchObject({ cwd: ROOT })
	})

	it('does not format when the install fails, and names both commands to rerun', () => {
		mocked_execa.mockReturnValueOnce(result(1))

		const failure = init_install.run_post_init_steps(ROOT)

		expect(commands()).toStrictEqual([PNPM_INSTALL])
		expect(failure).toContain('pnpm install failed')
		expect(failure).toContain('pnpm install && pnpm josh format')
	})

	// `josh format` runs `eslint --fix` in a node project, which fails on the project's own code.
	it('warns instead of failing when the format fails', () => {
		const warn_spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		mocked_execa.mockReturnValueOnce(result(0)).mockReturnValueOnce(result(1))

		expect(init_install.run_post_init_steps(ROOT)).toBeUndefined()
		expect(warn_spy).toHaveBeenCalledWith(expect.stringContaining('run: pnpm josh format'))
	})
})

describe('split_install_flag', () => {
	it('installs by default and leaves the profile arguments untouched', () => {
		expect(init_install.split_install_flag(['--profile', 'node'])).toStrictEqual({
			is_install: true,
			rest: ['--profile', 'node'],
		})
	})

	it('opts out with --no-install, wherever it appears', () => {
		expect(init_install.split_install_flag([...STATIC_PROFILE, NO_INSTALL_FLAG])).toStrictEqual({
			is_install: false,
			rest: STATIC_PROFILE,
		})
		expect(init_install.split_install_flag([NO_INSTALL_FLAG]).rest).toStrictEqual([])
	})
})
