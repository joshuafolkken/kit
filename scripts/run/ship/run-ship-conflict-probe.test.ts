import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_conflict_probe } from './run-ship-conflict-probe'

// joshuafolkken/kit#5018, with real git: whether the branch would conflict with origin/main is a
// property of git's merge. The fetch moves `origin/main` to the fixture's own `main`; the branch's
// change is left uncommitted, as `josh ship` meets it.

const TIMEOUT_MS = 30_000
const WORKSPACE_PREFIX = 'kit-ship-conflict-probe-'
const MAIN = 'main'
const LANE = '5018-lane'
const SHARED_FILE = 'shared.ts'
const OTHER_FILE = 'other.ts'
const CATALOG_FILE = 'docs/josh-command-catalog.md'
const BASE_VALUE = 'export const value = 1\n'
const LANE_VALUE = 'export const value = 2\n'
const MAIN_VALUE = 'export const value = 3\n'

const { git, MAIN_BRANCH } = git_fixture_workspace

const fixture: FixtureWorkspace = {
	workspace: '',
	previous_cwd: '',
	restore_environment: undefined,
}

async function write(relative: string, content: string): Promise<void> {
	await writeFile(path.join(fixture.workspace, relative), content)
}

async function commit_all(message: string): Promise<void> {
	await git(fixture.workspace, ['add', '--all'])
	await git(fixture.workspace, ['commit', '--no-verify', '-m', message])
}

// `main` moves `relative` on past the lane's base; the lane is then checked out from that base.
async function main_moves(relative: string, content: string): Promise<void> {
	await git(fixture.workspace, ['branch', LANE])
	await write(relative, content)
	await commit_all(MAIN)
	await git(fixture.workspace, ['switch', LANE])
}

// The fetch is stubbed by the update it makes, so the unit suite reaches no remote.
async function fetch_locally(branch: string): Promise<string> {
	return await git(fixture.workspace, ['update-ref', `refs/remotes/origin/${branch}`, branch])
}

async function tree_state(): Promise<string> {
	const status = await git(fixture.workspace, ['status', '--porcelain'])
	const diff = await git(fixture.workspace, ['diff'])
	const index = await git(fixture.workspace, ['diff', '--cached'])

	return [status, diff, index].join('\n---\n')
}

beforeEach(async () => {
	Object.assign(fixture, git_fixture_workspace.open_workspace(WORKSPACE_PREFIX))
	await git(fixture.workspace, ['init', MAIN_BRANCH])
	await write(SHARED_FILE, BASE_VALUE)
	await commit_all('base')
	process.chdir(fixture.workspace)
	vi.spyOn(git_command, 'fetch_branch').mockImplementation(fetch_locally)
}, TIMEOUT_MS)

afterEach(async () => {
	vi.restoreAllMocks()
	await git_fixture_workspace.close_workspace(fixture)
}, TIMEOUT_MS)

describe('run_ship_conflict_probe.probe', () => {
	it(
		'names the file the uncommitted change conflicts on with origin/main',
		async () => {
			await main_moves(SHARED_FILE, MAIN_VALUE)
			await write(SHARED_FILE, LANE_VALUE)

			const stop = await run_ship_conflict_probe.probe()

			expect(stop?.conflicts).toStrictEqual([SHARED_FILE])
			expect(stop?.code).toBe(1)
			expect(stop?.out).toContain(run_ship_conflict_probe.CONFLICT_NOTE)
		},
		TIMEOUT_MS,
	)

	it(
		'leaves the working tree and the index as it found them',
		async () => {
			await main_moves(SHARED_FILE, MAIN_VALUE)
			await write(SHARED_FILE, LANE_VALUE)
			await write(OTHER_FILE, BASE_VALUE)
			await git(fixture.workspace, ['add', OTHER_FILE])
			const before = await tree_state()

			await run_ship_conflict_probe.probe()

			expect(await tree_state()).toBe(before)
		},
		TIMEOUT_MS,
	)
})

describe('run_ship_conflict_probe.probe on a branch that merges cleanly', () => {
	it(
		'answers nothing when origin/main moved only other files',
		async () => {
			await main_moves(OTHER_FILE, MAIN_VALUE)
			await write(SHARED_FILE, LANE_VALUE)

			await expect(run_ship_conflict_probe.probe()).resolves.toBeUndefined()
		},
		TIMEOUT_MS,
	)

	it(
		'answers nothing when the only conflict is on a file the sync regenerates',
		async () => {
			await mkdir(path.join(fixture.workspace, path.dirname(CATALOG_FILE)), { recursive: true })
			await write(CATALOG_FILE, BASE_VALUE)
			await commit_all('catalog')
			await main_moves(CATALOG_FILE, MAIN_VALUE)
			await write(CATALOG_FILE, LANE_VALUE)

			await expect(run_ship_conflict_probe.probe()).resolves.toBeUndefined()
		},
		TIMEOUT_MS,
	)

	it(
		'answers nothing when the fetch fails, leaving the conflict to the sync stage',
		async () => {
			await main_moves(SHARED_FILE, MAIN_VALUE)
			await write(SHARED_FILE, LANE_VALUE)
			vi.mocked(git_command.fetch_branch).mockRejectedValue(new Error('offline'))

			await expect(run_ship_conflict_probe.probe()).resolves.toBeUndefined()
		},
		TIMEOUT_MS,
	)
})
