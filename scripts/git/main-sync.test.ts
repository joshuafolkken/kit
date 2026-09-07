import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#1535: what this pins is the refusal. `josh ms` run from a lane hijacked the
// default branch, took that work tree out of `lane:list` and made every other lane's `ms` fail —
// so the case worth a test is the one where the two git directories differ.

vi.mock('./git-command', () => ({
	git_command: {
		checkout: vi.fn(),
		get_default_branch: vi.fn(),
		git_directories: vi.fn(),
		pull: vi.fn(),
	},
}))

const { git_command } = await import('./git-command')
const { main_sync } = await import('./main-sync')

const MAIN_GIT_DIRECTORY = '/repo/.git'
const LANE_GIT_DIRECTORY = '/repo/.git/worktrees/1535'
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const NO_ARGUMENTS: ReadonlyArray<string> = []
const WORKERS_FLAG = '--workers=1'
const CHECKOUT_FAILURE = 'local changes would be overwritten'

const git_directories = vi.mocked(git_command.git_directories)
const checkout = vi.mocked(git_command.checkout)
const pull = vi.mocked(git_command.pull)

function in_main_work_tree(): void {
	git_directories.mockResolvedValue([MAIN_GIT_DIRECTORY, MAIN_GIT_DIRECTORY])
}

function in_a_lane(): void {
	git_directories.mockResolvedValue([LANE_GIT_DIRECTORY, MAIN_GIT_DIRECTORY])
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.mocked(git_command.get_default_branch).mockResolvedValue('main')
	checkout.mockResolvedValue('')
	pull.mockResolvedValue()
	in_main_work_tree()
})

describe('syncing the main work tree', () => {
	it('checks out the default branch and pulls', async () => {
		expect(await main_sync.run(NO_ARGUMENTS)).toBe(SUCCESS_EXIT_CODE)
		expect(checkout).toHaveBeenCalledWith('main')
		expect(pull).toHaveBeenCalledOnce()
	})

	it('follows the repository default branch rather than assuming main', async () => {
		vi.mocked(git_command.get_default_branch).mockResolvedValue('develop')

		await main_sync.run(NO_ARGUMENTS)

		expect(checkout).toHaveBeenCalledWith('develop')
	})

	it('reports a git failure as a message rather than throwing', async () => {
		checkout.mockRejectedValue(new Error(CHECKOUT_FAILURE))

		expect(await main_sync.run(NO_ARGUMENTS)).toBe(FAILURE_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(CHECKOUT_FAILURE)
	})
})

describe('refusing to run inside a lane', () => {
	it('exits non-zero when the two git directories differ', async () => {
		in_a_lane()

		expect(await main_sync.run(NO_ARGUMENTS)).toBe(FAILURE_EXIT_CODE)
	})

	// The hijack is the whole defect: nothing may reach `git checkout` from a linked work tree.
	it('asks git for no checkout and no pull', async () => {
		in_a_lane()

		await main_sync.run(NO_ARGUMENTS)

		expect(checkout).not.toHaveBeenCalled()
		expect(pull).not.toHaveBeenCalled()
	})

	it('names lane:close as the way out', async () => {
		in_a_lane()

		await main_sync.run(NO_ARGUMENTS)

		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('josh lane:close'))
	})
})

describe('refusing extra arguments', () => {
	it('keeps the message the composite form printed, and runs nothing', async () => {
		expect(await main_sync.run([WORKERS_FLAG])).toBe(FAILURE_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining('josh main:sync takes no extra arguments'),
		)
		expect(checkout).not.toHaveBeenCalled()
	})

	// Ordered before the work-tree read, so the usage error does not depend on git answering.
	it('refuses without asking git anything', async () => {
		await main_sync.run([WORKERS_FLAG])

		expect(git_directories).not.toHaveBeenCalled()
	})
})
