import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GIT_BINARY_KEY } from './constants'
import { git_fixture_workspace, type FixtureWorkspace } from './git-fixture-workspace'
import { main_merge_regenerate, type RegeneratedFile } from './main-merge-regenerate'

// joshuafolkken/kit#3922: both sides of a merge change a ratchet, git stops on it, and the table's
// command writes the resolution — asserted against real git, since what is pinned is the merge state
// git is left in.

const WORKSPACE_PREFIX = 'kit-main-merge-regenerate-'
const REPOSITORY = 'repository'
const DEFAULT_BRANCH = 'main'
const LANE_BRANCH = '3922-lane'
const MERGE_SUBJECT = 'Merge main #3922'
const AUTHOR_EMAIL = 'fixture@example.test'
const RATCHET = 'ratchet.txt'
const HAND_WRITTEN = 'hand.txt'
const REGENERATED = 'regenerated\n'
const MERGE_COMMIT_PARENTS = 2
const TIMEOUT_MS = 30_000

const { git, MAIN_BRANCH } = git_fixture_workspace
const fixture: FixtureWorkspace & { repository_root: string } = {
	workspace: '',
	previous_cwd: '',
	repository_root: '',
	restore_environment: undefined,
}

function table_writing(content: string): ReadonlyArray<RegeneratedFile> {
	const script = `require('node:fs').writeFileSync(${JSON.stringify(RATCHET)}, ${JSON.stringify(content)})`

	return [{ path: RATCHET, command: [process.execPath, '-e', script] }]
}

async function read_ratchet(): Promise<string> {
	return await readFile(path.join(fixture.repository_root, RATCHET), 'utf8')
}

async function commit_files(files: ReadonlyArray<string>, content: string): Promise<void> {
	await Promise.all(
		files.map(async (file) => {
			await writeFile(path.join(fixture.repository_root, file), content)
		}),
	)
	await git(fixture.repository_root, ['add', ...files])
	await git(fixture.repository_root, ['commit', '--no-verify', '-m', content])
}

// Both sides change every file in `files`, so the merge into the lane stops on each of them.
async function conflict_on(files: ReadonlyArray<string>): Promise<void> {
	await git(fixture.repository_root, ['checkout', '-b', LANE_BRANCH])
	await commit_files(files, 'lane')
	await git(fixture.repository_root, ['checkout', DEFAULT_BRANCH])
	await commit_files(files, DEFAULT_BRANCH)
	await git(fixture.repository_root, ['checkout', LANE_BRANCH])
	await expect(
		git(fixture.repository_root, ['merge', '-m', MERGE_SUBJECT, DEFAULT_BRANCH]),
	).rejects.toThrow()
}

async function is_merging(): Promise<boolean> {
	try {
		await git(fixture.repository_root, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'])

		return true
	} catch {
		return false
	}
}

async function head_parent_count(): Promise<number> {
	const parents = await git(fixture.repository_root, ['log', '-1', '--format=%P'])

	return parents.split(' ').length
}

// The commit `resolve` makes runs git with this process's environment, so the identity and the
// fixture's no-signing, no-maintenance options reach it here rather than through a config write.
function stub_commit_environment(): void {
	vi.stubEnv(GIT_BINARY_KEY, '')
	vi.stubEnv('GIT_AUTHOR_NAME', git_fixture_workspace.AUTHOR_NAME)
	vi.stubEnv('GIT_AUTHOR_EMAIL', AUTHOR_EMAIL)
	vi.stubEnv('GIT_COMMITTER_NAME', git_fixture_workspace.AUTHOR_NAME)
	vi.stubEnv('GIT_COMMITTER_EMAIL', AUTHOR_EMAIL)
	vi.stubEnv('GIT_CONFIG_COUNT', '2')
	vi.stubEnv('GIT_CONFIG_KEY_0', 'commit.gpgsign')
	vi.stubEnv('GIT_CONFIG_VALUE_0', 'false')
	vi.stubEnv('GIT_CONFIG_KEY_1', 'maintenance.auto')
	vi.stubEnv('GIT_CONFIG_VALUE_1', 'false')
}

beforeEach(async () => {
	Object.assign(fixture, git_fixture_workspace.open_workspace(WORKSPACE_PREFIX))
	fixture.repository_root = path.join(fixture.workspace, REPOSITORY)
	await git(fixture.workspace, ['init', MAIN_BRANCH, REPOSITORY])
	await commit_files([RATCHET, HAND_WRITTEN], 'base')
	process.chdir(fixture.repository_root)
	stub_commit_environment()
}, TIMEOUT_MS)

afterEach(async () => {
	vi.unstubAllEnvs()
	await git_fixture_workspace.close_workspace(fixture)
})

describe('finishing a merge that stopped on generated files', () => {
	it(
		'regenerates a ratchet both sides changed and commits the merge',
		async () => {
			await conflict_on([RATCHET])

			expect(await main_merge_regenerate.resolve([RATCHET], table_writing(REGENERATED))).toBe(true)
			expect(await read_ratchet()).toBe(REGENERATED)
			expect(await is_merging()).toBe(false)
			expect(await head_parent_count()).toBe(MERGE_COMMIT_PARENTS)
			expect(await git(fixture.repository_root, ['log', '-1', '--format=%s'])).toBe(MERGE_SUBJECT)
		},
		TIMEOUT_MS,
	)
})

describe('stopping on a merge regeneration cannot finish', () => {
	it(
		'leaves the merge in progress when a hand-written file conflicts too',
		async () => {
			await conflict_on([RATCHET, HAND_WRITTEN])

			expect(
				await main_merge_regenerate.resolve([RATCHET, HAND_WRITTEN], table_writing(REGENERATED)),
			).toBe(false)
			expect(await is_merging()).toBe(true)
			expect(await read_ratchet()).toContain('<<<<<<<')
		},
		TIMEOUT_MS,
	)

	it(
		'leaves the merge in progress when the regenerating command fails',
		async () => {
			await conflict_on([RATCHET])
			const failing: ReadonlyArray<RegeneratedFile> = [
				{ path: RATCHET, command: [process.execPath, '-e', 'process.exit(1)'] },
			]

			expect(await main_merge_regenerate.resolve([RATCHET], failing)).toBe(false)
			expect(await is_merging()).toBe(true)
		},
		TIMEOUT_MS,
	)
})
