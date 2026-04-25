import { describe, expect, it, vi } from 'vitest'

vi.mock('./git/git-command', () => ({
	git_command: { branch: vi.fn() },
}))

vi.mock('node:fs', () => ({
	readFileSync: vi.fn(),
}))

describe('check-commit-message — side-effect-free import', () => {
	it('does not call console.info or process.exit on import', async () => {
		const console_spy = vi.spyOn(console, 'info').mockImplementation(vi.fn())
		const exit_spy = vi.spyOn(process, 'exit').mockImplementation(vi.fn() as never)

		await import('./check-commit-message')

		expect(console_spy).not.toHaveBeenCalled()
		expect(exit_spy).not.toHaveBeenCalled()
	})
})
