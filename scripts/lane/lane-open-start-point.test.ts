import { cpSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_gh_pr_auto_merge } from '#scripts/gh/git-gh-pr-auto-merge'
import { git_command } from '#scripts/git/git-command'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { git_worktree } from '#scripts/git/git-worktree'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_install } from './lane-install'
import { lane_open } from './lane-open'
import { lane_paths } from './lane-paths'
import { lane_registry } from './lane-registry'
import { lane_seat_ownership } from './lane-seat-ownership'
import { lane_state } from './lane-state'

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

// The repository is built once per file and copied into each test's own workspace: every test starts
// from the same ref state, and git spawns dominate the suite's run time (joshuafolkken/kit#9016).
const template: { workspace: FixtureWorkspace | undefined } = { workspace: undefined }

async function commit_all(message: string, root = fixture.repository_root): Promise<void> {
	await git(root, ['add', '--all'])
	await git(root, ['commit', '-m', message])
}

// The one absolute path the repository holds, so a copy re-points it at its own workspace.
async function set_origin_url(root: string): Promise<void> {
	await git(root, ['config', 'remote.origin.url', path.join(path.dirname(root), 'upstream.git')])
}

// `origin` is configured with `config` rather than `git remote add`, which the unit suite's network
// guard refuses outright. The configuration is not decoration: git only treats a ref under
// `refs/remotes/origin/` as a *remote-tracking branch* — and so only applies `branch.autoSetupMerge`
// to it — when the remote it names actually exists, which is what makes `--no-track` observable here.
async function declare_origin(root: string): Promise<void> {
	await set_origin_url(root)
	await git(root, ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'])
}

// `origin/main` is moved ahead of `main` with `update-ref`, then the local branch is rewound: the
// unit suite's network guard refuses `fetch` and `remote` outright, and neither is needed to produce
// the ref state under test.
async function advance_origin_past_local_main(root: string): Promise<void> {
	await declare_origin(root)
	await git(root, [UPDATE_REF, ORIGIN_MAIN_REF, 'refs/heads/main'])
	await git(root, ['symbolic-ref', 'refs/remotes/origin/HEAD', ORIGIN_MAIN_REF])
	await git(root, ['reset', '--hard', 'HEAD~1'])
}

async function build_repository(workspace: string): Promise<void> {
	const root = path.join(workspace, PRIMARY)

	await git(workspace, ['init', MAIN_BRANCH, PRIMARY])
	writeFileSync(path.join(root, 'base.txt'), 'base\n')
	await commit_all('base', root)
	writeFileSync(path.join(root, MERGED_FILE), 'merged\n')
	await commit_all('merged', root)
	await advance_origin_past_local_main(root)
}

async function copy_template(): Promise<void> {
	const source = path.join(template.workspace?.workspace ?? '', PRIMARY)

	cpSync(source, fixture.repository_root, { recursive: true })
	await set_origin_url(fixture.repository_root)
}

beforeAll(async () => {
	template.workspace = git_fixture_workspace.open_workspace(WORKSPACE_PREFIX)
	await build_repository(template.workspace.workspace)
}, TIMEOUT_MS)

afterAll(async () => {
	const { workspace } = template

	if (workspace !== undefined) await git_fixture_workspace.close_workspace(workspace)
})

function lane_directory(): string {
	return path.join(lane_paths.lane_root(fixture.repository_root), ISSUE)
}

function lane_holds(name: string): boolean {
	return existsSync(path.join(lane_directory(), name))
}

// `git config --get-all` exits non-zero for a key that is not set, which reads as empty here.
async function branch_config(branch_name: string, field: 'merge' | 'remote'): Promise<string> {
	const key = `branch.${branch_name}.${field}`

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
	vi.spyOn(git_gh_pr_auto_merge, 'pr_list_open_with_head_prefix').mockResolvedValue([])
	vi.spyOn(git_command, 'fetch_branch').mockResolvedValue('')
	vi.spyOn(git_worktree, 'ls_remote_branch').mockResolvedValue('')
	vi.spyOn(lane_install, 'install_dependencies').mockResolvedValue({
		is_installed: true,
		output: '',
	})
	// The stage an open writes is a run's, and this fixture is no run.
	vi.spyOn(run_event_setup, 'emit').mockResolvedValue()
}

beforeEach(async () => {
	vi.spyOn(lane_seat_ownership, 'snapshot').mockResolvedValue({
		running: new Set(),
		ports: new Set(),
	})
	const opened = git_fixture_workspace.open_workspace(WORKSPACE_PREFIX)

	fixture.previous_cwd = opened.previous_cwd
	fixture.restore_environment = opened.restore_environment
	fixture.workspace = opened.workspace
	fixture.repository_root = path.join(opened.workspace, PRIMARY)
	Reflect.deleteProperty(process.env, lane_paths.LANE_ROOT_KEY)
	// The fetch is the one step this fixture cannot take — the suite's network guard refuses it — and
	// it is not what is under test: the assertion is which ref the lane is cut from.
	stub_what_the_fixture_cannot_do()

	await copy_template()
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
	// `git_command.push` does not retry. `--no-track` is what keeps `pnpm josh git` working in a lane;
	// the upstream is then set to the lane's own name, which a Codex lane's sandbox cannot write itself
	// (joshuafolkken/kit#4653).
	it(
		'points the lane branch at its own name, so a bare push cannot aim at the default branch',
		async () => {
			const outcome = await lane_open.open_lane(ISSUE)
			const branch = lane_paths.lane_branch(ISSUE)

			expect(outcome.kind).toBe('opened')
			// Both halves: a merge ref without its remote is no upstream, and the push falls back again.
			expect(await branch_config(branch, 'merge')).toBe(`refs/heads/${branch}`)
			expect(await branch_config(branch, 'remote')).toBe('origin')
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

async function build_pushed_lane_branch(branch = LANE_BRANCH): Promise<void> {
	const root = fixture.repository_root

	await git(root, ['checkout', '-q', '--no-track', '-b', branch, ORIGIN_MAIN_REF])
	writeFileSync(path.join(root, PUSHED_FILE), 'pushed\n')
	await commit_all('work the child already pushed')
	await git(root, ['checkout', '-q', MAIN])
}

// What `lane:close` leaves: `remove_lane` runs `git branch -D`, and nothing deletes the
// remote-tracking ref the push created.
async function drop_local_lane_branch(branch = LANE_BRANCH): Promise<void> {
	const root = fixture.repository_root
	const pushed = await git(root, ['rev-parse', branch])

	await git(root, [UPDATE_REF, `refs/remotes/origin/${branch}`, pushed])
	await git(root, ['branch', '-D', branch])
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
			vi.spyOn(git_worktree, 'ls_remote_branch').mockResolvedValue(`sha\trefs/heads/${LANE_BRANCH}`)

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

async function prepare_legacy_pull(remote_only: boolean, branch: string): Promise<string> {
	await build_pushed_lane_branch(branch)
	const head = await git(fixture.repository_root, ['rev-parse', branch])
	if (remote_only) await drop_local_lane_branch(branch)
	vi.mocked(git_gh_pr_auto_merge.pr_list_open_with_head_prefix).mockResolvedValue([
		{ number: 7498, head_ref: branch, has_auto_merge: false },
	])

	return head
}

describe('resuming the existing pull request through lane open', () => {
	it.each([false, true])(
		'preserves a legacy PR and its work, remote-only: %s (ac-6810beb4)',
		async (remote_only) => {
			const branch = `${ISSUE}-legacy-implementation`

			const head = await prepare_legacy_pull(remote_only, branch)

			const outcome = await lane_open.open_lane(ISSUE)

			expect(outcome.kind).toBe('opened')
			expect(await git(lane_directory(), ['branch', '--show-current'])).toBe(branch)
			expect(await git(lane_directory(), ['rev-parse', 'HEAD'])).toBe(head)
			expect(lane_holds(PUSHED_FILE)).toBe(true)
			expect(await git_command.branch_exists(LANE_BRANCH)).toBe(false)
			expect(lane_registry.find_lane(await lane_registry.list_lanes(), ISSUE)?.branch).toBe(branch)
			expect(await branch_config(branch, 'merge')).toBe(`refs/heads/${branch}`)
		},
		TIMEOUT_MS,
	)

	it('refuses an open PR whose head could not be fetched (ac-0009c1ae)', async () => {
		vi.mocked(git_gh_pr_auto_merge.pr_list_open_with_head_prefix).mockResolvedValue([
			{ number: 7498, head_ref: `${ISSUE}-missing`, has_auto_merge: false },
		])
		vi.mocked(git_command.fetch_branch).mockRejectedValue(new Error('offline'))

		await expect(lane_open.open_lane(ISSUE)).rejects.toThrow('could not be fetched')
		expect(existsSync(lane_directory())).toBe(false)
	})
})

describe('the state record an opened lane starts', () => {
	it(
		'records the lane as open by lane:open',
		async () => {
			const record = vi.spyOn(lane_state, 'record_change')

			await lane_open.open_lane(ISSUE)

			expect(record).toHaveBeenCalledExactlyOnceWith({
				issue: ISSUE,
				state: 'open',
				command: 'lane:open',
			})
		},
		TIMEOUT_MS,
	)
})
