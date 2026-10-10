import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { INSTALL_TIMEOUT_MS, SUITE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { git_common_directory } from './git-common-directory'
import { git_worktree } from './git-worktree'

// The subject here is the argument list each call hands the shared spawn helper, so the double is of
// `git_spawn` rather than of `execa`: `git-command.test.ts` already exercises the spawn layer itself
// through the real module, and repeating that mock here would clone it for nothing.
//
// The double also counts how many calls are inside git at once, and holds each one open for a few
// milliseconds so two calls left to run side by side would overlap there (joshuafolkken/kit#2736).
const spawn_mock = vi.hoisted(() => {
	const HOLD_MS = 20
	const state = {
		last_arguments: [] as Array<string>,
		last_timeout_ms: undefined as number | undefined,
		// What the remote spawn was handed, kept apart so a call routed through `read` leaves it empty.
		remote_arguments: [] as Array<string>,
		active: 0,
		peak: 0,
	}

	async function read_remote(arguments_: Array<string>): Promise<string> {
		state.remote_arguments = [...arguments_]

		return ''
	}

	async function read(arguments_: Array<string>, timeout_ms?: number): Promise<string> {
		state.last_arguments = [...arguments_]
		state.last_timeout_ms = timeout_ms
		state.active += 1
		state.peak = Math.max(state.peak, state.active)
		await new Promise<void>((resolve) => {
			setTimeout(resolve, HOLD_MS)
		})
		state.active -= 1

		return ''
	}

	return { state, read, read_remote }
})

vi.mock('./git-spawn', () => ({
	git_spawn: { read: spawn_mock.read, read_remote: spawn_mock.read_remote },
}))

// joshuafolkken/kit#1490: a lane's whole lifecycle is these four calls, and each one's flags are the
// difference between a lane that closes cleanly and debris nobody can account for.
const ORIGIN_MAIN_REF = 'refs/remotes/origin/main'
const LANE_DIRECTORY = '/w/.kit-lanes/1490'
const LANE_BRANCH = '1490-lane'

// joshuafolkken/kit#1709: what `ls-remote` is asked for is a full ref path, so that a pattern which
// matches the tail of some *other* ref cannot answer for this branch. Written out rather than
// composed from `LANE_BRANCH`, because the wire format is the subject here — a composed expectation
// would restate the implementation instead of pinning it.
const LANE_BRANCH_REF = 'refs/heads/1490-lane'
const RELEASE_BRANCH = 'release/v1.2.0'
const RELEASE_BRANCH_REF = 'refs/heads/release/v1.2.0'

// The lock record is keyed on the git common directory; pointing that at a scratch directory keeps
// this suite's lock apart from any real lane opening on the same machine.
const scratch = mkdtempSync(path.join(tmpdir(), 'git-worktree-test-'))

beforeEach(() => {
	spawn_mock.state.last_arguments = []
	spawn_mock.state.last_timeout_ms = undefined
	spawn_mock.state.remote_arguments = []
	spawn_mock.state.peak = 0
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(scratch)
})

afterAll(() => {
	vi.restoreAllMocks()
	rmSync(scratch, { force: true, recursive: true })
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

// joshuafolkken/kit#3590: an add checks a tree out, so a consumer's `post-checkout` hook runs inside
// it and a local git command's budget would end the add mid-hook.
describe('git_worktree budgets', () => {
	it('gives both adds the budget of a suite', async () => {
		await git_worktree.worktree_add(LANE_DIRECTORY, LANE_BRANCH, ORIGIN_MAIN_REF)
		const add_timeout_ms = spawn_mock.state.last_timeout_ms

		await git_worktree.worktree_add_detached(LANE_DIRECTORY, 'abc1234')

		expect(add_timeout_ms).toBe(SUITE_TIMEOUT_MS)
		expect(spawn_mock.state.last_timeout_ms).toBe(SUITE_TIMEOUT_MS)
	})

	// It runs no hook, but it deletes the `node_modules` an install wrote: cut at a local command's
	// budget it leaves a half-deleted tree, and `release_worktree.remove` raises instead of going on.
	it('gives a removal the budget of an install', async () => {
		await git_worktree.worktree_remove(LANE_DIRECTORY)

		expect(spawn_mock.state.last_timeout_ms).toBe(INSTALL_TIMEOUT_MS)
	})

	it('leaves a prune on the local budget', async () => {
		await git_worktree.worktree_prune()

		expect(spawn_mock.state.last_timeout_ms).toBeUndefined()
	})
})

describe('git_worktree lane reads', () => {
	it('asks for the machine-readable listing rather than the displayed one', async () => {
		await git_worktree.worktree_list()

		expect(spawn_mock.state.last_arguments).toStrictEqual(['worktree', 'list', '--porcelain'])
	})

	// Asked of the remote rather than of a remote-tracking ref, because nothing prunes those and a
	// stale one cannot say "gone" (joshuafolkken/kit#1627). The pattern is the full ref path, so that
	// a branch pushed under a prefix — `refs/heads/wip/1490-lane` is the shape that bit — can no
	// longer answer for this one on a ref-tail match (joshuafolkken/kit#1709). It goes through the
	// remote spawn: `read` is bounded as a local command, too short for a slow connection
	// (joshuafolkken/kit#3590).
	it('asks the remote for the full ref path of the lane branch, not the bare name', async () => {
		await git_worktree.ls_remote_branch(LANE_BRANCH)

		expect(spawn_mock.state.remote_arguments).toStrictEqual([
			'ls-remote',
			'--heads',
			'origin',
			LANE_BRANCH_REF,
		])
	})

	// A release branch name already carries a slash, which is the case the anchoring could plausibly
	// get wrong twice over: the prefix has to go on exactly once, and the result still has to exclude
	// `refs/heads/foo/release/v1.2.0`, which the bare name matched (joshuafolkken/kit#1709).
	it('prefixes a slash-bearing release branch name exactly once', async () => {
		await git_worktree.ls_remote_branch(RELEASE_BRANCH)

		expect(spawn_mock.state.remote_arguments).toStrictEqual([
			'ls-remote',
			'--heads',
			'origin',
			RELEASE_BRANCH_REF,
		])
	})
})

// joshuafolkken/kit#1627: attaching is the only way back to a child parked after it pushed. `-b`
// refuses the branch that is already there, and deleting it to get `-b` back would take the pushed
// commits with it. `--no-track` belongs to the branch creation, and git rejects it on this form.
// joshuafolkken/kit#2736: two lanes opened at once ran `git worktree add` side by side, and one read
// the other's half-built `.git/worktrees/<id>/` and failed. Every call that writes that directory now
// runs under one repository-wide lock, so no two of them are inside git at the same time.
describe('git_worktree serializes the calls that write .git/worktrees', () => {
	it('never runs two concurrent adds inside git at once', async () => {
		await Promise.all([
			git_worktree.worktree_add(LANE_DIRECTORY, LANE_BRANCH, ORIGIN_MAIN_REF),
			git_worktree.worktree_add(`${LANE_DIRECTORY}-2`, `${LANE_BRANCH}-2`, ORIGIN_MAIN_REF),
		])

		expect(spawn_mock.state.peak).toBe(1)
	})

	it('serializes an add against a detached add, a removal and a prune', async () => {
		await Promise.all([
			git_worktree.worktree_add(LANE_DIRECTORY, LANE_BRANCH, ORIGIN_MAIN_REF),
			git_worktree.worktree_add_detached(`${LANE_DIRECTORY}-red`, 'HEAD'),
			git_worktree.worktree_remove(`${LANE_DIRECTORY}-old`),
			git_worktree.worktree_prune(),
		])

		expect(spawn_mock.state.peak).toBe(1)
	})

	it('lets the reads run side by side, since they write nothing', async () => {
		await Promise.all([git_worktree.worktree_list(), git_worktree.worktree_list()])

		expect(spawn_mock.state.peak).toBe(2)
	})
})

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
