import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#scripts/git/git-command', () => ({
	git_command: { branch: vi.fn(), get_default_branch: vi.fn() },
}))

const { git_command } = await import('#scripts/git/git-command')
const mocked_branch = vi.mocked(git_command.branch)
const mocked_get_default_branch = vi.mocked(git_command.get_default_branch)

mocked_branch.mockResolvedValue('feature-branch')
mocked_get_default_branch.mockResolvedValue('main')

// The spies watch the module's first import, so a side effect at load time is caught; their counts are
// read before `beforeEach` clears them.
const console_spy = vi.spyOn(console, 'info').mockImplementation(vi.fn())
const exit_spy = vi.spyOn(process, 'exit').mockImplementation(vi.fn() as never)
const { check_main_branch } = await import('./prevent-main-commit')
const import_calls = { info: console_spy.mock.calls.length, exit: exit_spy.mock.calls.length }

console_spy.mockRestore()
exit_spy.mockRestore()

beforeEach(() => {
	mocked_get_default_branch.mockResolvedValue('main')
})

describe('prevent-main-commit — side-effect-free import', () => {
	it('does not call console.info or process.exit on import', () => {
		expect(import_calls.info).toBe(0)
		expect(import_calls.exit).toBe(0)
	})
})

describe('check_main_branch', () => {
	const FEATURE_BRANCH = '123-some-feature'
	const NOT_ALLOWED_MSG = 'not allowed'

	it('returns failure result when on main branch', async () => {
		mocked_branch.mockResolvedValue('main')

		const result = await check_main_branch()

		expect(result.success).toBe(false)
		expect(result.message).toContain(NOT_ALLOWED_MSG)
	})

	it('returns success result when on a feature branch', async () => {
		mocked_branch.mockResolvedValue(FEATURE_BRANCH)

		const result = await check_main_branch()

		expect(result.success).toBe(true)
		expect(result.message).toContain(FEATURE_BRANCH)
	})

	it('returns failure result when on non-main default branch', async () => {
		mocked_branch.mockResolvedValue('develop')
		mocked_get_default_branch.mockResolvedValue('develop')

		const result = await check_main_branch()

		expect(result.success).toBe(false)
		expect(result.message).toContain(NOT_ALLOWED_MSG)
	})
})
