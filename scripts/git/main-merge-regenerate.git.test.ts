import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GIT_BINARY_KEY } from './constants'
import { git_fixture_workspace, type FixtureWorkspace } from './git-fixture-workspace'
import { main_merge_budget_conflict } from './main-merge-budget-conflict'
import {
	main_merge_regenerate,
	type RegeneratedFile,
	type ResolvedFile,
} from './main-merge-regenerate'

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
const BUDGET = 'budget.ts'
const REGENERATED = 'regenerated\n'
// The page-ceiling table's shape around the row joshuafolkken/kit#4958 and #4960 both raised.
const BUDGET_HEAD = "const DOCUMENT_BYTE_BUDGET = [\n\t{ path: 'a.md', bytes: 4096 },\n"
const BUDGET_TAIL = "\t{ path: 'c.md', bytes: 8192 },\n]\n"
const BUDGET_BASE = `${BUDGET_HEAD}\t{ path: 'b.md', bytes: 57_344 },\n${BUDGET_TAIL}`
const LANE_COMMENT = '\t// `josh effect:audit` (joshuafolkken/kit#4958) crossed the 57344 block.\n'
const MAIN_COMMENT = '\t// `issue:priority` (joshuafolkken/kit#4960) crossed the 57344 block.\n'
const RAISED_ROW = "\t{ path: 'b.md', bytes: 61_440 },\n"
const MERGE_COMMIT_PARENTS = 2
const TIMEOUT_MS = 30_000

const { git, MAIN_BRANCH } = git_fixture_workspace
const fixture: FixtureWorkspace & { repository_root: string } = {
	workspace: '',
	previous_cwd: '',
	repository_root: '',
	restore_environment: undefined,
}

function table_writing(content: string): ReadonlyArray<ResolvedFile> {
	const script = `require('node:fs').writeFileSync(${JSON.stringify(RATCHET)}, ${JSON.stringify(content)})`

	return [
		{ path: RATCHET, command: [process.execPath, '-e', script] },
		{ path: BUDGET, rewrite: main_merge_budget_conflict.resolve },
	]
}

async function read_ratchet(): Promise<string> {
	return await readFile(path.join(fixture.repository_root, RATCHET), 'utf8')
}

type FileContents = ReadonlyArray<readonly [file: string, content: string]>

async function commit_contents(contents: FileContents, message: string): Promise<void> {
	await Promise.all(
		contents.map(async ([file, content]) => {
			await writeFile(path.join(fixture.repository_root, file), content)
		}),
	)
	await git(fixture.repository_root, ['add', ...contents.map(([file]) => file)])
	await git(fixture.repository_root, ['commit', '--no-verify', '-m', message])
}

async function commit_files(files: ReadonlyArray<string>, content: string): Promise<void> {
	await commit_contents(
		files.map((file) => [file, content]),
		content,
	)
}

// The lane and the default branch each commit their contents, and the merge into the lane stops.
async function conflict_between(lane: FileContents, main: FileContents): Promise<void> {
	await git(fixture.repository_root, ['checkout', '-b', LANE_BRANCH])
	await commit_contents(lane, 'lane')
	await git(fixture.repository_root, ['checkout', DEFAULT_BRANCH])
	await commit_contents(main, DEFAULT_BRANCH)
	await git(fixture.repository_root, ['checkout', LANE_BRANCH])
	await expect(
		git(fixture.repository_root, ['merge', '-m', MERGE_SUBJECT, DEFAULT_BRANCH]),
	).rejects.toThrow()
}

// Both sides change every file in `files`, so the merge into the lane stops on each of them.
async function conflict_on(files: ReadonlyArray<string>): Promise<void> {
	await conflict_between(
		files.map((file) => [file, 'lane']),
		files.map((file) => [file, DEFAULT_BRANCH]),
	)
}

// Both sides raise the same ceiling row with their own comment, as joshuafolkken/kit#4958 and #4960 did.
async function budget_conflict(also: FileContents = []): Promise<void> {
	await commit_files([BUDGET], BUDGET_BASE)
	await conflict_between(
		[[BUDGET, `${BUDGET_HEAD}${LANE_COMMENT}${RAISED_ROW}${BUDGET_TAIL}`], ...also],
		[
			[BUDGET, `${BUDGET_HEAD}${MAIN_COMMENT}${RAISED_ROW}${BUDGET_TAIL}`],
			...also.map(([file]) => [file, DEFAULT_BRANCH] as const),
		],
	)
}

async function read_budget(): Promise<string> {
	return await readFile(path.join(fixture.repository_root, BUDGET), 'utf8')
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

describe('finishing a merge that stopped on page-ceiling rows', () => {
	it(
		'keeps both comments and the raised ceiling, and commits the merge',
		async () => {
			await budget_conflict()

			expect(await main_merge_regenerate.resolve([BUDGET], table_writing(REGENERATED))).toBe(true)
			expect(await read_budget()).toBe(
				`${BUDGET_HEAD}${LANE_COMMENT}${MAIN_COMMENT}${RAISED_ROW}${BUDGET_TAIL}`,
			)
			expect(await is_merging()).toBe(false)
			expect(await head_parent_count()).toBe(MERGE_COMMIT_PARENTS)
		},
		TIMEOUT_MS,
	)

	it(
		'resolves the ceiling rows and a generated file that conflict together',
		async () => {
			await budget_conflict([[RATCHET, 'lane']])

			expect(
				await main_merge_regenerate.resolve([BUDGET, RATCHET], table_writing(REGENERATED)),
			).toBe(true)
			expect(await read_ratchet()).toBe(REGENERATED)
			expect(await read_budget()).not.toContain('<<<<<<<')
			expect(await is_merging()).toBe(false)
		},
		TIMEOUT_MS,
	)
})

describe('stopping on a page-ceiling conflict outside the rows', () => {
	it(
		'leaves the merge in progress when the conflict is outside the ceiling rows',
		async () => {
			await commit_files([BUDGET], BUDGET_BASE)
			await conflict_between(
				[[BUDGET, `const LANE_BUDGET = [\n${BUDGET_BASE}`]],
				[[BUDGET, `const MAIN_BUDGET = [\n${BUDGET_BASE}`]],
			)

			expect(await main_merge_regenerate.resolve([BUDGET], table_writing(REGENERATED))).toBe(false)
			expect(await is_merging()).toBe(true)
			expect(await read_budget()).toContain('<<<<<<<')
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
