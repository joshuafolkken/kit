import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_install } from './lane-install'
import { lane_open } from './lane-open'
import { lane_paths } from './lane-paths'

// The regression this suite exists for (joshuafolkken/kit#1535): a lane opened after a merge must
// carry what was merged. It drives **real git**, because what it asserts is a property of git's own
// ref resolution — that a bare `main` means `refs/heads/main`, and that `refs/heads/main` is not
// where the merges land. A mocked git could only re-assert the argument list `lane-open.test.ts`
// already pins.
//
// The fixture stands in for a merge by advancing `refs/remotes/origin/main` past `refs/heads/main`,
// which is the exact shape this repository is in after `pnpm josh followup`: the remote-
// tracking ref moves on the next fetch, and the local branch — checked out in no work tree — never
// does. Measured on 2026-09-07 in this repository: `refs/heads/main` `e3a68c04`,
// `refs/remotes/origin/main` `78f746f9`.

const TIMEOUT_MS = 30_000
const ISSUE = '1535'
const WORKSPACE_PREFIX = 'lane-open-start-point-'
const MERGED_FILE = 'merged-after-the-lane-base.txt'
const PRIMARY = 'primary'
const ORIGIN_MAIN_REF = 'refs/remotes/origin/main'
const UPDATE_REF = 'update-ref'
const { git, MAIN_BRANCH } = git_fixture_workspace

const fixture: FixtureWorkspace & { repository_root: string } = {
	previous_cwd: '',
	repository_root: '',
	restore_environment: undefined,
	workspace: '',
}

async function commit_all(message: string): Promise<void> {
	await git(fixture.repository_root, ['add', '--all'])
	await git(fixture.repository_root, ['commit', '-m', message])
}

// `origin` is configured with `config` rather than `git remote add`, which the unit suite's network
// guard refuses outright. The configuration is not decoration: git only treats a ref under
// `refs/remotes/origin/` as a *remote-tracking branch* — and so only applies `branch.autoSetupMerge`
// to it — when the remote it names actually exists, which is what makes `--no-track` observable here.
async function declare_origin(): Promise<void> {
	const root = fixture.repository_root

	await git(root, ['config', 'remote.origin.url', path.join(fixture.workspace, 'upstream.git')])
	await git(root, ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'])
}

// `origin/main` is moved ahead of `main` with `update-ref`, then the local branch is rewound: the
// unit suite's network guard refuses `fetch` and `remote` outright, and neither is needed to produce
// the ref state under test.
async function advance_origin_past_local_main(): Promise<void> {
	const root = fixture.repository_root

	await declare_origin()
	await git(root, [UPDATE_REF, ORIGIN_MAIN_REF, 'refs/heads/main'])
	await git(root, ['symbolic-ref', 'refs/remotes/origin/HEAD', ORIGIN_MAIN_REF])
	await git(root, ['reset', '--hard', 'HEAD~1'])
}

async function build_repository(): Promise<void> {
	await git(fixture.workspace, ['init', MAIN_BRANCH, PRIMARY])
	writeFileSync(path.join(fixture.repository_root, 'base.txt'), 'base\n')
	await commit_all('base')
	writeFileSync(path.join(fixture.repository_root, MERGED_FILE), 'merged\n')
	await commit_all('merged')
	await advance_origin_past_local_main()
}

function lane_directory(): string {
	return path.join(lane_paths.lane_root(fixture.repository_root), ISSUE)
}

function lane_holds(name: string): boolean {
	return existsSync(path.join(lane_directory(), name))
}

// `git config --get-all` exits non-zero for a key that is not set, which is the passing case here.
async function configured_upstream(branch_name: string): Promise<string> {
	const key = `branch.${branch_name}.merge`

	try {
		return await git(fixture.repository_root, ['config', '--get-all', key])
	} catch {
		return ''
	}
}

// What the fixture cannot do for itself. The two git reads talk to a remote, which the unit suite's
// network guard refuses outright — and neither is what is under test: the assertions are about which
// ref the lane is cut from. `ls_remote_branch` answers empty, which is "not on the remote", the state
// every test here starts from; the one that reopens a pushed branch says otherwise
// (joshuafolkken/kit#1627). The install is stubbed for the reason git is not
// (joshuafolkken/kit#1554): this fixture commits text files and no `package.json`, so a real
// `pnpm install` would fail on a manifest that was never the subject.
function stub_what_the_fixture_cannot_do(): void {
	vi.spyOn(git_command, 'fetch_branch').mockResolvedValue('')
	vi.spyOn(git_command, 'ls_remote_branch').mockResolvedValue('')
	vi.spyOn(lane_install, 'install_dependencies').mockResolvedValue({
		is_installed: true,
		output: '',
	})
}

beforeEach(async () => {
	const opened = git_fixture_workspace.open_workspace(WORKSPACE_PREFIX)

	fixture.previous_cwd = opened.previous_cwd
	fixture.restore_environment = opened.restore_environment
	fixture.workspace = opened.workspace
	fixture.repository_root = path.join(opened.workspace, PRIMARY)
	Reflect.deleteProperty(process.env, lane_paths.LANE_ROOT_KEY)
	// The fetch is the one step this fixture cannot take — the suite's network guard refuses it — and
	// it is not what is under test: the assertion is which ref the lane is cut from.
	stub_what_the_fixture_cannot_do()

	await build_repository()
	process.chdir(fixture.repository_root)
}, TIMEOUT_MS)

afterEach(async () => {
	vi.restoreAllMocks()
	await git_fixture_workspace.close_workspace(fixture)
})

describe('the commit a new lane starts from', () => {
	it(
		'carries the work merged after the local default branch stopped moving',
		async () => {
			const outcome = await lane_open.open_lane(ISSUE)

			expect(outcome.kind).toBe('opened')
			expect(lane_holds(MERGED_FILE)).toBe(true)
		},
		TIMEOUT_MS,
	)

	// Cutting from a remote-tracking ref makes git's default `branch.autoSetupMerge` point the lane
	// branch's upstream at the default branch, and a bare `git push` then refuses with an error
	// `git_command.push` does not retry. `--no-track` is what keeps `pnpm josh git` working in a lane.
	it(
		'leaves the lane branch with no upstream, so a bare push cannot aim at the default branch',
		async () => {
			const outcome = await lane_open.open_lane(ISSUE)

			const configured = await configured_upstream(lane_paths.lane_branch(ISSUE))

			expect(outcome.kind).toBe('opened')
			expect(configured).toBe('')
		},
		TIMEOUT_MS,
	)

	it(
		'writes the lane its own port seed beside the work tree',
		async () => {
			await lane_open.open_lane(ISSUE)

			expect(lane_holds('.env')).toBe(true)
		},
		TIMEOUT_MS,
	)
})

// joshuafolkken/kit#1627: the same fixture, asked the other question. A child parked after pushing
// leaves `<N>-lane` behind carrying commits that are on no other ref, and `lane:close` deletes the
// local branch while the remote one and the pull request stay. Reopening its lane has to land on
// those commits — real git again, because what is under test is whether `worktree add` put the tree
// on the branch that was there rather than on a new one of the same name.
const LANE_BRANCH = lane_paths.lane_branch(ISSUE)
const MAIN = 'main'
const PUSHED_FILE = 'work-the-child-already-pushed.txt'

async function build_pushed_lane_branch(): Promise<void> {
	const root = fixture.repository_root

	await git(root, ['checkout', '-q', '--no-track', '-b', LANE_BRANCH, ORIGIN_MAIN_REF])
	writeFileSync(path.join(root, PUSHED_FILE), 'pushed\n')
	await commit_all('work the child already pushed')
	await git(root, ['checkout', '-q', MAIN])
}

// What `lane:close` leaves: `remove_lane` runs `git branch -D`, and nothing deletes the
// remote-tracking ref the push created.
async function drop_local_lane_branch(): Promise<void> {
	const root = fixture.repository_root
	const pushed = await git(root, ['rev-parse', LANE_BRANCH])

	await git(root, [UPDATE_REF, `refs/remotes/origin/${LANE_BRANCH}`, pushed])
	await git(root, ['branch', '-D', LANE_BRANCH])
}

describe('reopening a lane whose branch already exists', () => {
	it(
		'attaches to the local branch, so the commits the child pushed are in the tree',
		async () => {
			await build_pushed_lane_branch()

			const outcome = await lane_open.open_lane(ISSUE)

			expect(outcome.kind).toBe('opened')
			expect(lane_holds(PUSHED_FILE)).toBe(true)
		},
		TIMEOUT_MS,
	)

	// The acceptance criterion that rules out the easy implementation: deleting the branch to get
	// `-b` back would open the lane and lose exactly what the reopen was for.
	it(
		'leaves the branch pointing where it did, rather than deleting and recreating it',
		async () => {
			await build_pushed_lane_branch()
			const before = await git(fixture.repository_root, ['rev-parse', LANE_BRANCH])

			await lane_open.open_lane(ISSUE)

			expect(await git(fixture.repository_root, ['rev-parse', LANE_BRANCH])).toBe(before)
		},
		TIMEOUT_MS,
	)
})

describe('reopening a lane whose branch is only on the remote', () => {
	it(
		'cuts from origin/<N>-lane when the local branch has already been deleted',
		async () => {
			await build_pushed_lane_branch()
			await drop_local_lane_branch()
			vi.spyOn(git_command, 'ls_remote_branch').mockResolvedValue(`sha\trefs/heads/${LANE_BRANCH}`)

			const outcome = await lane_open.open_lane(ISSUE)

			expect(outcome.kind).toBe('opened')
			expect(lane_holds(PUSHED_FILE)).toBe(true)
		},
		TIMEOUT_MS,
	)

	// The third path, stated as its own assertion: with neither branch there, nothing is reused.
	it(
		'carries no such work into a lane whose branch never existed',
		async () => {
			const outcome = await lane_open.open_lane(ISSUE)

			expect(outcome.kind).toBe('opened')
			expect(lane_holds(PUSHED_FILE)).toBe(false)
		},
		TIMEOUT_MS,
	)
})
