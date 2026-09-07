import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_open } from './lane-open'
import { lane_paths } from './lane-paths'

// The regression this suite exists for (joshuafolkken/kit#1535): a lane opened after a merge must
// carry what was merged. It drives **real git**, because what it asserts is a property of git's own
// ref resolution — that a bare `main` means `refs/heads/main`, and that `refs/heads/main` is not
// where the merges land. A mocked git could only re-assert the argument list `lane-open.test.ts`
// already pins.
//
// The fixture stands in for a merge by advancing `refs/remotes/origin/main` past `refs/heads/main`,
// which is the exact shape this repository is in after `pnpm josh followup --merge`: the remote-
// tracking ref moves on the next fetch, and the local branch — checked out in no work tree — never
// does. Measured on 2026-09-07 in this repository: `refs/heads/main` `e3a68c04`,
// `refs/remotes/origin/main` `78f746f9`.

const TIMEOUT_MS = 30_000
const ISSUE = '1535'
const WORKSPACE_PREFIX = 'lane-open-start-point-'
const MERGED_FILE = 'merged-after-the-lane-base.txt'
const PRIMARY = 'primary'
const ORIGIN_MAIN_REF = 'refs/remotes/origin/main'
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
	await git(root, ['update-ref', ORIGIN_MAIN_REF, 'refs/heads/main'])
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

beforeEach(async () => {
	const opened = git_fixture_workspace.open_workspace(WORKSPACE_PREFIX)

	fixture.previous_cwd = opened.previous_cwd
	fixture.restore_environment = opened.restore_environment
	fixture.workspace = opened.workspace
	fixture.repository_root = path.join(opened.workspace, PRIMARY)
	Reflect.deleteProperty(process.env, lane_paths.LANE_ROOT_KEY)
	// The fetch is the one step this fixture cannot take — the suite's network guard refuses it — and
	// it is not what is under test: the assertion is which ref the lane is cut from.
	vi.spyOn(git_command, 'fetch_branch').mockResolvedValue('')

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
			await lane_open.open_lane(ISSUE)

			const configured = await configured_upstream(lane_paths.lane_branch(ISSUE))

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
