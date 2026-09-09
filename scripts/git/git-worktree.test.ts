import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_worktree } from './git-worktree'

// The subject here is the argument list each call hands the shared spawn helper, so the double is of
// `git_spawn` rather than of `execa`: `git-command.test.ts` already exercises the spawn layer itself
// through the real module, and repeating that mock here would clone it for nothing.
const spawn_mock = vi.hoisted(() => {
	const state = { last_arguments: [] as Array<string> }

	async function read(arguments_: Array<string>): Promise<string> {
		state.last_arguments = [...arguments_]

		return ''
	}

	return { state, read }
})

vi.mock('./git-spawn', () => ({
	git_spawn: { read: spawn_mock.read },
}))

// joshuafolkken/kit#1490: a lane's whole lifecycle is these four calls, and each one's flags are the
// difference between a lane that closes cleanly and debris nobody can account for.
const ORIGIN_MAIN_REF = 'refs/remotes/origin/main'
const LANE_DIRECTORY = '/w/.kit-lanes/1490'
const LANE_BRANCH = '1490-lane'

beforeEach(() => {
	spawn_mock.state.last_arguments = []
})

describe('git_worktree worktree calls', () => {
	// `--no-track` is not decoration: the start point is a remote-tracking ref now, and without it
	// git points the lane branch's upstream at the default branch, where a bare `git push` fails with
	// an error `push()` does not retry as `--set-upstream` (joshuafolkken/kit#1535).
	it('creates the untracked branch as part of the add, from an explicit start point', async () => {
		await git_worktree.worktree_add(LANE_DIRECTORY, LANE_BRANCH, ORIGIN_MAIN_REF)

		expect(spawn_mock.state.last_arguments).toStrictEqual([
			'worktree',
			'add',
			'--no-track',
			'-b',
			LANE_BRANCH,
			LANE_DIRECTORY,
			ORIGIN_MAIN_REF,
		])
	})

	it('forces the removal, because a lane is closed with work still in it', async () => {
		await git_worktree.worktree_remove(LANE_DIRECTORY)

		expect(spawn_mock.state.last_arguments).toContain('--force')
	})

	it('deletes the lane branch with -D, since a parked lane never merged', async () => {
		await git_worktree.branch_delete(LANE_BRANCH)

		expect(spawn_mock.state.last_arguments).toStrictEqual(['branch', '-D', LANE_BRANCH])
	})

	it('prunes the registrations whose directories are gone', async () => {
		await git_worktree.worktree_prune()

		expect(spawn_mock.state.last_arguments).toStrictEqual(['worktree', 'prune'])
	})
})

describe('git_worktree lane reads', () => {
	it('asks for the machine-readable listing rather than the displayed one', async () => {
		await git_worktree.worktree_list()

		expect(spawn_mock.state.last_arguments).toStrictEqual(['worktree', 'list', '--porcelain'])
	})

	// Asked of the remote rather than of a remote-tracking ref, because nothing prunes those and a
	// stale one cannot say "gone" (joshuafolkken/kit#1627).
	it('asks the remote itself whether the lane branch is still there', async () => {
		await git_worktree.ls_remote_branch(LANE_BRANCH)

		expect(spawn_mock.state.last_arguments).toStrictEqual([
			'ls-remote',
			'--heads',
			'origin',
			LANE_BRANCH,
		])
	})
})

// joshuafolkken/kit#1627: attaching is the only way back to a child parked after it pushed. `-b`
// refuses the branch that is already there, and deleting it to get `-b` back would take the pushed
// commits with it. `--no-track` belongs to the branch creation, and git rejects it on this form.
describe('git_worktree worktree add on an existing branch', () => {
	it('passes neither --no-track nor -b when given no start point', async () => {
		await git_worktree.worktree_add(LANE_DIRECTORY, LANE_BRANCH, undefined)

		expect(spawn_mock.state.last_arguments).toStrictEqual([
			'worktree',
			'add',
			LANE_DIRECTORY,
			LANE_BRANCH,
		])
	})
})
