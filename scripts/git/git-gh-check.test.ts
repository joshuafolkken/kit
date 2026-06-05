import { beforeEach, describe, expect, it, vi } from 'vitest'

const execa_mock = vi.hoisted(() => {
	const state = { should_fail: false as boolean }

	async function mock_execa(_cmd: string, _arguments: Array<string>): Promise<{ stdout: string }> {
		if (state.should_fail) throw new Error('spawn gh ENOENT')

		return await Promise.resolve({ stdout: 'gh version 2.0.0' })
	}

	return { state, mock_execa }
})

vi.mock('execa', () => ({
	execa: execa_mock.mock_execa,
}))

beforeEach(() => {
	vi.resetModules()
	execa_mock.state.should_fail = false
})

describe('check_gh_installed', () => {
	it('resolves when gh responds successfully', async () => {
		const { check_gh_installed } = await import('./git-gh-check')

		await expect(check_gh_installed()).resolves.toBeUndefined()
	})

	it('throws GH_NOT_INSTALLED_MSG when exec fails', async () => {
		execa_mock.state.should_fail = true

		const { check_gh_installed, GH_NOT_INSTALLED_MSG } = await import('./git-gh-check')

		await expect(check_gh_installed()).rejects.toThrow(GH_NOT_INSTALLED_MSG)
	})

	it('calls the version check only once across multiple invocations', async () => {
		const { check_gh_installed } = await import('./git-gh-check')

		await check_gh_installed()
		execa_mock.state.should_fail = true

		await expect(check_gh_installed()).resolves.toBeUndefined()
	})
})

describe('GH_NOT_INSTALLED_MSG', () => {
	it('contains the gh CLI install URL', async () => {
		const { GH_NOT_INSTALLED_MSG } = await import('./git-gh-check')

		expect(GH_NOT_INSTALLED_MSG).toContain('https://cli.github.com/')
	})
})
