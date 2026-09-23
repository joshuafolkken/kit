import { beforeEach, describe, expect, it, vi } from 'vitest'

const git = vi.hoisted(() => ({
	branch: vi.fn(),
	commit_count_beyond: vi.fn(),
	default_branch_reference: vi.fn(),
	git_directories: vi.fn(),
	head_commit: vi.fn(),
}))
const ls_remote_branch = vi.hoisted(() => vi.fn())
const is_tree_dirty = vi.hoisted(() => vi.fn())
const read_pr_state = vi.hoisted(() => vi.fn())

vi.mock('#scripts/git/git-command', () => ({ git_command: git }))
vi.mock('#scripts/git/git-worktree', () => ({ git_worktree: { ls_remote_branch } }))
vi.mock('./run-hold', () => ({ run_hold: { is_tree_dirty } }))
vi.mock('./run-preflight', () => ({ run_preflight: { MERGED_PR: 'merged', read_pr_state } }))

const { run_ship_probe } = await import('./run-ship-probe')

// joshuafolkken/kit#2426: the actual state a resumed ship decides from — committed, pushed, merged —
// and the fail-quiet direction every unreadable answer takes.

const HEAD = 'abc123'
const AHEAD = 2
const NOT_A_REPOSITORY = 'not a repository'

beforeEach(() => {
	git.branch.mockResolvedValue('2426-lane')
	git.default_branch_reference.mockResolvedValue('refs/remotes/origin/main')
	git.commit_count_beyond.mockResolvedValue(AHEAD)
	git.head_commit.mockResolvedValue(HEAD)
	git.git_directories.mockResolvedValue(['/repo/.git/worktrees/lane', '/repo/.git'])
	is_tree_dirty.mockResolvedValue(false)
	ls_remote_branch.mockResolvedValue(`${HEAD}\trefs/heads/2426-lane`)
	read_pr_state.mockResolvedValue('merged')
})

describe('run_ship_probe.read_state — committed', () => {
	it('reads a clean tree ahead of the default branch as committed', async () => {
		expect(await run_ship_probe.read_state()).toMatchObject({ is_committed: true })
	})

	it('reads a dirty tree as not committed, whatever sits beneath it', async () => {
		is_tree_dirty.mockResolvedValue(true)

		expect(await run_ship_probe.read_state()).toMatchObject({ is_committed: false })
	})

	it('reads a clean tree level with the default branch as not committed', async () => {
		git.commit_count_beyond.mockResolvedValue(0)

		expect(await run_ship_probe.read_state()).toMatchObject({ is_committed: false })
	})
})

describe('run_ship_probe.read_state — pushed and merged', () => {
	it('reads origin holding HEAD as pushed', async () => {
		expect(await run_ship_probe.read_state()).toMatchObject({ is_pushed: true })
	})

	it('reads an origin tip behind HEAD as not pushed', async () => {
		ls_remote_branch.mockResolvedValue('def456\trefs/heads/2426-lane')

		expect(await run_ship_probe.read_state()).toMatchObject({ is_pushed: false })
	})

	it('reads an absent remote branch as not pushed', async () => {
		ls_remote_branch.mockResolvedValue('')

		expect(await run_ship_probe.read_state()).toMatchObject({ is_pushed: false })
	})

	it('reads a merged pull request as merged, and an open one as not', async () => {
		expect(await run_ship_probe.read_state()).toMatchObject({ is_merged: true })

		read_pr_state.mockResolvedValue('open')

		expect(await run_ship_probe.read_state()).toMatchObject({ is_merged: false })
	})
})

describe('run_ship_probe — unreadable answers read as not done', () => {
	it('reads every failed lookup as false', async () => {
		ls_remote_branch.mockRejectedValue(new Error('offline'))
		read_pr_state.mockRejectedValue(new Error('rate limited'))
		git.commit_count_beyond.mockRejectedValue(new Error('no base'))

		expect(await run_ship_probe.read_state()).toStrictEqual({
			is_committed: false,
			is_pushed: false,
			is_merged: false,
		})
	})

	it('reads an unreadable branch as nothing done', async () => {
		git.branch.mockRejectedValue(new Error(NOT_A_REPOSITORY))

		expect(await run_ship_probe.read_state()).toMatchObject({ is_merged: false })
	})

	it('keys the record on the common git directory, and has none outside a repository', async () => {
		expect(await run_ship_probe.record_target('2426')).toContain('josh-ship-stages-2426-')

		git.git_directories.mockRejectedValue(new Error(NOT_A_REPOSITORY))

		expect(await run_ship_probe.record_target('2426')).toBeUndefined()
	})
})
