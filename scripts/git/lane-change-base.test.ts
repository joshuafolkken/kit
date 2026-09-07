import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git_command } from './git-command'
import { git_fixture_workspace, type FixtureWorkspace } from './git-fixture-workspace'
import { git_location_environment } from './git-location-environment'

// joshuafolkken/kit#1527, with real git rather than a mocked one.
//
// A mocked test can only pin which arguments the reading passes; what actually broke is a property
// of git in a **linked work tree** — the `main` ref is shared across every work tree of the
// repository, so one lane merging changes what an unmerged lane's two-dot `git diff main` reports.
// Nothing short of building that topology demonstrates the fix, so this file builds it: a primary
// work tree, a lane cut from it, and a commit landing on `main` afterwards.

const TIMEOUT_MS = 30_000
const LANE_FILE = 'lane-change.txt'
const OTHER_LANE_FILE = 'other-lane-merged.txt'
const LANE_EDIT = 'edited by this lane\n'

const BYSTANDER = 'bystander'
const HOOK_FILE = 'made-under-a-hook.txt'
const WORKSPACE_PREFIX = 'kit-lane-base-'

const HOOK_CONTENT = 'under a hook\n'
const HOOK_SUBJECT = 'committed under a hook environment'

// The identity, the `-c` options that carry it, the `git` helper and the workspace lifecycle are
// `./git-fixture-workspace`, shared with `rename-changed-paths.test.ts` (joshuafolkken/kit#1533).
// They were copied into the second suite first; a hardening like joshuafolkken/kit#1530's lands in
// one copy and silently misses the other, so there is only one.
const { AUTHOR_NAME, git, MAIN_BRANCH } = git_fixture_workspace

const fixture: FixtureWorkspace & { repository_root: string; lane_root: string } = {
	workspace: '',
	repository_root: '',
	lane_root: '',
	previous_cwd: '',
	restore_environment: undefined,
}

// `--local` rather than the effective value: what is being asserted is that this fixture wrote
// nothing into a config file, not what the machine's own git happens to be configured with.
//
// It reads with `execa` directly rather than through the shared helper, because the point is to ask
// git a question with no `-c` identity attached — the very options the helper always carries.
async function local_identity(cwd: string): Promise<string> {
	const { stdout } = await execa('git', ['config', '--local', '--get', 'user.email'], {
		cwd,
		reject: false,
		env: git_location_environment.location_free_environment(),
		extendEnv: true,
	})

	return stdout.trim()
}

async function commit_all(cwd: string, message: string): Promise<void> {
	await git(cwd, ['add', '--all'])
	await git(cwd, ['commit', '--no-verify', '-m', message])
}

async function build_repository(): Promise<void> {
	await writeFile(path.join(fixture.repository_root, LANE_FILE), 'base\n')
	await commit_all(fixture.repository_root, 'base')
}

// A stand-in for the repository a hook is firing in. Never the real one: pointing `GIT_DIR` at the
// checkout is the damage under test, not an acceptable way to detect it.
async function build_bystander(): Promise<string> {
	const root = path.join(fixture.workspace, BYSTANDER)

	await git(fixture.workspace, ['init', MAIN_BRANCH, BYSTANDER])
	await writeFile(path.join(root, LANE_FILE), 'bystander\n')
	await commit_all(root, 'bystander base')

	return root
}

// The lane is cut first, and only afterwards does another lane's work land on the shared `main`.
async function advance_main_after_cutting_the_lane(): Promise<void> {
	const add_worktree = ['worktree', 'add', '-b', 'lane-under-test', fixture.lane_root]

	await git(fixture.repository_root, add_worktree)
	await writeFile(
		path.join(fixture.repository_root, OTHER_LANE_FILE),
		'merged by a different lane\n',
	)
	await commit_all(fixture.repository_root, 'another lane merged')
}

beforeEach(async () => {
	// `open_workspace` is what clears the git location variables for this process too, not only for
	// the children `git()` spawns. The assertions drive `git_command`, which spawns `git` with no
	// environment of its own and so inherits this one — under a hook that made the readings answer
	// about the repository being pushed, which is the other half of what joshuafolkken/kit#1530 saw.
	const opened = git_fixture_workspace.open_workspace(WORKSPACE_PREFIX)

	fixture.workspace = opened.workspace
	fixture.previous_cwd = opened.previous_cwd
	fixture.restore_environment = opened.restore_environment
	fixture.repository_root = path.join(fixture.workspace, 'primary')
	fixture.lane_root = path.join(fixture.workspace, 'lane')

	await git(fixture.workspace, ['init', MAIN_BRANCH, 'primary'])
	await build_repository()
	await advance_main_after_cutting_the_lane()
}, TIMEOUT_MS)

afterEach(async () => {
	await git_fixture_workspace.close_workspace(fixture)
})

// The regression joshuafolkken/kit#1530 was filed for. The condition is "run with a hook-like
// environment", so the test sets those variables deliberately and asserts that the repository they
// point at came through untouched.
describe('the fixture built with a git hook environment inherited', () => {
	it(
		'writes nothing into the repository the environment points at',
		async () => {
			const bystander = await build_bystander()
			const head_before = await git(bystander, ['rev-parse', 'HEAD'])

			process.env['GIT_DIR'] = path.join(bystander, '.git')
			process.env['GIT_INDEX_FILE'] = path.join(bystander, '.git', 'index')
			await writeFile(path.join(fixture.repository_root, HOOK_FILE), HOOK_CONTENT)
			await commit_all(fixture.repository_root, HOOK_SUBJECT)

			await expect(git(bystander, ['rev-parse', 'HEAD'])).resolves.toBe(head_before)
			await expect(local_identity(bystander)).resolves.toBe('')
		},
		TIMEOUT_MS,
	)

	// The commit has to land somewhere, and "nowhere" would satisfy the assertions above.
	it(
		'still commits into the fixture it was handed',
		async () => {
			process.env['GIT_DIR'] = path.join(await build_bystander(), '.git')
			await writeFile(path.join(fixture.repository_root, HOOK_FILE), HOOK_CONTENT)
			await commit_all(fixture.repository_root, HOOK_SUBJECT)

			const subject = await git(fixture.repository_root, ['log', '-1', '--format=%s'])

			expect(subject).toBe(HOOK_SUBJECT)
		},
		TIMEOUT_MS,
	)
})

// The second symptom: the identity rides on `-c`, so no config file anywhere gains it.
describe('the fixture identity', () => {
	it(
		'is carried as options rather than written into config',
		async () => {
			await expect(local_identity(fixture.repository_root)).resolves.toBe('')
			await expect(git(fixture.repository_root, ['log', '-1', '--format=%an'])).resolves.toBe(
				AUTHOR_NAME,
			)
		},
		TIMEOUT_MS,
	)
})

describe('a lane reads its own changes while the shared default branch advances', () => {
	it(
		'leaves a file merged by another lane out of the listing while the work is uncommitted',
		async () => {
			await writeFile(path.join(fixture.lane_root, LANE_FILE), LANE_EDIT)
			process.chdir(fixture.lane_root)

			const names = await git_command.diff_main_names()

			expect(names.split('\n')).toStrictEqual([LANE_FILE])
			expect(names).not.toContain(OTHER_LANE_FILE)
		},
		TIMEOUT_MS,
	)

	// A lane works uncommitted for most of a run and committed for the rest of it, so the base has to
	// be right at both points: once `HEAD` moves ahead, the merge base has to stay where it was.
	it(
		'still reports only the change this branch made once the lane has committed',
		async () => {
			await writeFile(path.join(fixture.lane_root, LANE_FILE), LANE_EDIT)
			await commit_all(fixture.lane_root, 'lane work')
			process.chdir(fixture.lane_root)

			await expect(git_command.diff_main_names()).resolves.toBe(LANE_FILE)
		},
		TIMEOUT_MS,
	)
})

describe('the gate stamp base across the same advance', () => {
	// Nothing this lane's checks read has changed, so a green record taken before another lane's
	// merge still covers this tree — and it only does if the base it names has not moved.
	it(
		'holds still across a merge made by another lane',
		async () => {
			process.chdir(fixture.lane_root)
			const before = await git_command.change_base_commit()

			await writeFile(path.join(fixture.repository_root, 'third.txt'), 'a third lane\n')
			await commit_all(fixture.repository_root, 'a third lane merged')

			await expect(git_command.change_base_commit()).resolves.toBe(before)
		},
		TIMEOUT_MS,
	)

	// The primary work tree is the case that must not change: sitting on the default branch, the
	// merge base *is* that branch's commit, so the reading is exactly what it always was.
	it(
		'reads the same as before in a checkout sitting on the default branch',
		async () => {
			await writeFile(path.join(fixture.repository_root, LANE_FILE), 'edited on main\n')
			process.chdir(fixture.repository_root)

			await expect(git_command.diff_main_names()).resolves.toBe(LANE_FILE)
		},
		TIMEOUT_MS,
	)
})
