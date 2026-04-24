import { describe, expect, it, vi } from 'vitest'

const exec_mock = vi.hoisted(() => {
	const state = { should_fail: false as boolean }

	async function mock_exec_async(_command: string): Promise<{ stdout: string; stderr: string }> {
		if (state.should_fail) throw new Error('spawn gh ENOENT')

		return await Promise.resolve({ stdout: 'gh version 2.0.0', stderr: '' })
	}

	return { state, mock_exec_async }
})

vi.mock('node:util', () => ({
	promisify: () => exec_mock.mock_exec_async,
}))

const { check_gh_installed, GH_NOT_INSTALLED_MSG } = await import('./git-gh-check')

describe('check_gh_installed', () => {
	it('resolves when gh responds successfully', async () => {
		exec_mock.state.should_fail = false

		await expect(check_gh_installed()).resolves.toBeUndefined()
	})

	it('throws GH_NOT_INSTALLED_MSG when exec fails', async () => {
		exec_mock.state.should_fail = true

		await expect(check_gh_installed()).rejects.toThrow(GH_NOT_INSTALLED_MSG)
	})
})

describe('GH_NOT_INSTALLED_MSG', () => {
	it('contains the gh CLI install URL', () => {
		expect(GH_NOT_INSTALLED_MSG).toContain('https://cli.github.com/')
	})
})
