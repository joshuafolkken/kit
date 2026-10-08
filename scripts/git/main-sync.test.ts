import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#1535: what this pins is the refusal. `josh ms` run from a lane hijacked the
// default branch, took that work tree out of `lane:list` and made every other lane's `ms` fail —
// so the case worth a test is the one where the two git directories differ.

vi.mock('./git-command', () => ({
	git_command: {
		branch: vi.fn(),
		checkout: vi.fn(),
		fast_forward_local: vi.fn(),
		get_default_branch: vi.fn(),
		git_directories: vi.fn(),
		pull_fast_forward: vi.fn(),
		repository_root: vi.fn(),
	},
}))

vi.mock('./gone-branch', () => ({ gone_branch: { prune: vi.fn() } }))

vi.mock('./lockfile-sync', () => ({
	lockfile_sync: { reinstall_if_stale: vi.fn() },
}))

const { git_command } = await import('./git-command')
const { gone_branch } = await import('./gone-branch')
const { lockfile_sync } = await import('./lockfile-sync')
const { main_sync } = await import('./main-sync')

const MAIN_GIT_DIRECTORY = '/repo/.git'
const LANE_GIT_DIRECTORY = '/repo/.git/worktrees/1535'
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const NO_ARGUMENTS: ReadonlyArray<string> = []
const WORKERS_FLAG = '--workers=1'
const CHECKOUT_FAILURE = 'local changes would be overwritten'
const FEATURE_BRANCH = '2979-lane'

const git_directories = vi.mocked(git_command.git_directories)
const checkout = vi.mocked(git_command.checkout)
const pull = vi.mocked(git_command.pull_fast_forward)
const fast_forward = vi.mocked(git_command.fast_forward_local)
const current_branch = vi.mocked(git_command.branch)
const prune = vi.mocked(gone_branch.prune)
const reinstall = vi.mocked(lockfile_sync.reinstall_if_stale)

const REPOSITORY_ROOT = '/repo'
const INSTALL_OUTPUT = 'ERR_PNPM_OUTDATED_LOCKFILE'

function in_main_work_tree(): void {
	git_directories.mockResolvedValue([MAIN_GIT_DIRECTORY, MAIN_GIT_DIRECTORY])
}

// What follows the pull — nothing to prune and an unchanged lock — so a test changes only its own step.
function with_a_quiet_tail(): void {
	prune.mockResolvedValue({ deleted: [], failed: [] })
	vi.mocked(git_command.repository_root).mockResolvedValue(REPOSITORY_ROOT)
	reinstall.mockResolvedValue({ is_installed: true, output: '' })
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
	current_branch.mockResolvedValue(FEATURE_BRANCH)
	fast_forward.mockResolvedValue('')
	pull.mockResolvedValue()
	with_a_quiet_tail()
	in_main_work_tree()
})

// joshuafolkken/kit#3463: a pull that added a dependency left `node_modules` behind the lock, and every
// `josh` typed in the primary checkout failed to load it. When the install runs is pinned in
// `lockfile-sync.test.ts`; this pins that the sync asks for it in the repository root after the pull.
describe('reinstalling when the pull changed the lock', () => {
	it('asks for the reinstall in the repository root once the pull has run', async () => {
		await main_sync.run(NO_ARGUMENTS)

		expect(reinstall).toHaveBeenCalledWith(REPOSITORY_ROOT)
		expect(pull.mock.invocationCallOrder[0]).toBeLessThan(
			reinstall.mock.invocationCallOrder[0] ?? 0,
		)
	})

	it('exits non-zero and shows the install output when the install fails', async () => {
		reinstall.mockResolvedValue({ is_installed: false, output: INSTALL_OUTPUT })

		expect(await main_sync.run(NO_ARGUMENTS)).toBe(FAILURE_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(INSTALL_OUTPUT))
	})

	it('reinstalls nothing inside a lane', async () => {
		in_a_lane()

		await main_sync.run(NO_ARGUMENTS)

		expect(reinstall).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#2504: which branches go is pinned in `gone-branch.test.ts`; this pins that the
// sync asks for it, after the pull, against the default branch.
describe('pruning after the sync', () => {
	it('prunes against the default branch once the pull has run', async () => {
		await main_sync.run(NO_ARGUMENTS)

		expect(prune).toHaveBeenCalledWith('main')
		expect(pull.mock.invocationCallOrder[0]).toBeLessThan(prune.mock.invocationCallOrder[0] ?? 0)
	})

	it('reports how many branches were pruned', async () => {
		prune.mockResolvedValue({ deleted: ['12-lane', '13-lane'], failed: [] })

		await main_sync.run(NO_ARGUMENTS)

		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('pruned 2'))
	})

	it('names a branch git refused to delete, and still succeeds', async () => {
		prune.mockResolvedValue({ deleted: [], failed: ['14-lane'] })

		expect(await main_sync.run(NO_ARGUMENTS)).toBe(SUCCESS_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('14-lane'))
	})

	it('reports a prune that throws, and keeps the finished sync a success', async () => {
		prune.mockRejectedValue(new Error('unknown field name: worktreepath'))

		expect(await main_sync.run(NO_ARGUMENTS)).toBe(SUCCESS_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('branch prune skipped'))
		expect(console.info).toHaveBeenCalledWith('main')
	})

	it('prunes nothing inside a lane', async () => {
		in_a_lane()

		await main_sync.run(NO_ARGUMENTS)

		expect(prune).not.toHaveBeenCalled()
	})
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

// joshuafolkken/kit#2979: a ledger line appended after the merge made the checkout of a stale default
// branch refuse, so `run:tail`'s sync failed whenever its flush had work.
describe('fast-forwarding the default branch before the checkout', () => {
	it('fast-forwards the local default branch before checking it out', async () => {
		await main_sync.run(NO_ARGUMENTS)

		expect(fast_forward).toHaveBeenCalledWith('main')
		expect(fast_forward.mock.invocationCallOrder[0]).toBeLessThan(
			checkout.mock.invocationCallOrder[0] ?? 0,
		)
	})

	it('skips the fast-forward when already on the default branch', async () => {
		current_branch.mockResolvedValue('main')

		await main_sync.run(NO_ARGUMENTS)

		expect(fast_forward).not.toHaveBeenCalled()
		expect(pull).toHaveBeenCalledOnce()
	})

	it('still checks out and pulls when the fast-forward is refused', async () => {
		fast_forward.mockRejectedValue(new Error('non-fast-forward'))

		expect(await main_sync.run(NO_ARGUMENTS)).toBe(SUCCESS_EXIT_CODE)
		expect(checkout).toHaveBeenCalledWith('main')
		expect(pull).toHaveBeenCalledOnce()
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
