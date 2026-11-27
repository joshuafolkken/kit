import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./git-spawn', () => ({ git_spawn: { read: vi.fn(), with_output: vi.fn() } }))
vi.mock('./git-command', () => ({
	git_command: { branch: vi.fn(), get_default_branch: vi.fn() },
}))
vi.mock('./git-worktree', () => ({ git_worktree: { is_linked: vi.fn() } }))

const { git_checkpoint } = await import('./git-checkpoint')
const { git_spawn } = await import('./git-spawn')
const { git_command } = await import('./git-command')
const { git_worktree } = await import('./git-worktree')

const SHORT_SHA = 'abc1234'
const ARGV = ['theme', 'theme colors']

function arrange(linked: boolean, branch: string): void {
	vi.mocked(git_worktree.is_linked).mockResolvedValue(linked)
	vi.mocked(git_command.branch).mockResolvedValue(branch)
	vi.mocked(git_command.get_default_branch).mockResolvedValue('main')
	vi.mocked(git_spawn.read).mockResolvedValue(SHORT_SHA)
	vi.mocked(git_spawn.with_output).mockResolvedValue()
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
})

describe('git_checkpoint.run — a checkpoint', () => {
	it('stages, commits with lefthook skipped and points wip/<name> at it', async () => {
		arrange(true, '9091-lane')

		await expect(git_checkpoint.run(ARGV)).resolves.toBe(0)
		expect(git_spawn.read).toHaveBeenCalledWith(['add', '-A'])
		expect(git_spawn.with_output).toHaveBeenCalledWith(
			'commit',
			['-m', 'WIP checkpoint: theme colors'],
			expect.objectContaining({ environment: { LEFTHOOK: '0' } }),
		)
		expect(git_spawn.read).toHaveBeenCalledWith(['branch', '-f', 'wip/theme', 'HEAD'])
	})

	it('fails when the commit fails', async () => {
		arrange(true, '9091-lane')
		const reason = 'nothing to commit'

		vi.mocked(git_spawn.with_output).mockRejectedValue(new Error(reason))

		await expect(git_checkpoint.run(ARGV)).resolves.toBe(1)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(reason))
	})
})

describe('git_checkpoint.run — refusals', () => {
	it.each([
		['outside a linked worktree', false, '9091-lane', 'not a linked worktree'],
		['on the default branch', true, 'main', 'the default branch'],
	])('refuses %s without touching the tree', async (_name, linked, branch, reason) => {
		arrange(linked, branch)

		await expect(git_checkpoint.run(ARGV)).resolves.toBe(1)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(reason))
		expect(git_spawn.read).not.toHaveBeenCalled()
	})

	it.each([
		['no arguments', []],
		['no description', ['theme']],
		['a blank description', ['theme', '  ']],
		['a name with a slash', ['a/b', 'x']],
		['an extra argument', ['theme', 'x', 'y']],
	])('prints the usage for %s', async (_name, argv) => {
		arrange(true, '9091-lane')

		await expect(git_checkpoint.run(argv)).resolves.toBe(1)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('usage:'))
		expect(git_worktree.is_linked).not.toHaveBeenCalled()
	})
})
