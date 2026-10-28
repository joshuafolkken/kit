import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import type { LanePlan } from '#scripts/lane/lane-plan'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#5307, with real git: a ship stopped on a conflict with the default branch tells
// the lane to resolve it and re-detach uncommitted, and the re-detach was refused as `unplanned` for
// every code file the default branch had brought in. Only the stopped merge itself demonstrates it,
// so this file builds one. The plan record is the one thing read from outside the repository, so it
// alone is mocked.

const read_mock = vi.hoisted(() => vi.fn<(issue: number) => LanePlan | undefined>())

vi.mock('#scripts/lane/lane-plan', () => ({ lane_plan: { read: read_mock } }))

const { run_ship_planned } = await import('./run-ship-planned')
const { gate_tree } = await import('#scripts/gate/gate-tree')

const TIMEOUT_MS = 30_000
const WORKSPACE_PREFIX = 'kit-ship-planned-'
const ISSUE = 5307
const LANE_BRANCH = `${String(ISSUE)}-lane`
const PLANNED_FILE = 'planned.ts'
const UNPLANNED_FILE = 'unplanned.ts'
const INCOMING_FILE = 'incoming.ts'

const { git, MAIN_BRANCH } = git_fixture_workspace

const fixture: FixtureWorkspace & { root: string } = {
	workspace: '',
	root: '',
	previous_cwd: '',
	restore_environment: undefined,
}

function plan(paths: Array<string>): LanePlan {
	return { issue: ISSUE, paths, planned_at: '2026-10-28T00:00:00Z' }
}

async function commit_file(name: string, content: string): Promise<void> {
	await writeFile(path.join(fixture.root, name), `${content}\n`)
	await git(fixture.root, ['add', '--all'])
	await git(fixture.root, ['commit', '--no-verify', '-m', `${name} ${content}`])
}

// The lane and the default branch both edit the planned file, so merging the default branch stops
// on it with the default branch's own code file already in the tree.
async function stop_a_merge_on_a_conflict(): Promise<void> {
	await commit_file(PLANNED_FILE, 'base')
	await git(fixture.root, ['switch', '-c', LANE_BRANCH])
	await commit_file(PLANNED_FILE, 'lane')
	await commit_file(UNPLANNED_FILE, 'lane')
	await git(fixture.root, ['switch', 'main'])
	await commit_file(INCOMING_FILE, 'main')
	await commit_file(PLANNED_FILE, 'main')
	await git(fixture.root, ['switch', LANE_BRANCH])
	await expect(git(fixture.root, ['merge', 'main'])).rejects.toThrow()
}

beforeEach(async () => {
	const opened = git_fixture_workspace.open_workspace(WORKSPACE_PREFIX)

	fixture.workspace = opened.workspace
	fixture.previous_cwd = opened.previous_cwd
	fixture.restore_environment = opened.restore_environment
	fixture.root = path.join(fixture.workspace, 'repository')

	await git(fixture.workspace, ['init', MAIN_BRANCH, 'repository'])
	await stop_a_merge_on_a_conflict()
	process.chdir(fixture.root)
	read_mock.mockReset().mockReturnValue(plan([PLANNED_FILE]))
}, TIMEOUT_MS)

afterEach(async () => {
	await git_fixture_workspace.close_workspace(fixture)
})

describe('run_ship_planned.unplanned during a merge stopped on a conflict', () => {
	it(
		'does not count a code file the default branch alone brought in',
		async () => {
			read_mock.mockReturnValue(plan([PLANNED_FILE, UNPLANNED_FILE]))

			await expect(run_ship_planned.unplanned()).resolves.toBeUndefined()
		},
		TIMEOUT_MS,
	)

	it(
		'still counts an unplanned code file the branch itself committed',
		async () => {
			const found = await run_ship_planned.unplanned()

			expect(found?.files).toStrictEqual([UNPLANNED_FILE])
		},
		TIMEOUT_MS,
	)
})

// The gate's record pairs the file map with its base, so the base is read through the same merge: a
// map from the later base beside `HEAD`'s older one would reuse a record over a re-merged main.
describe('gate_tree.read_gate_tree during a merge stopped on a conflict', () => {
	it(
		'records the later base, beside a map without the default branch’s files',
		async () => {
			const tree = await gate_tree.read_gate_tree()

			expect(tree.base).toBe(await git(fixture.root, ['rev-parse', 'main']))
			expect(Object.keys(tree.files)).not.toContain(INCOMING_FILE)
		},
		TIMEOUT_MS,
	)
})
