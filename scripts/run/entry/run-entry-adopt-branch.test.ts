import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_ancestor } from '#scripts/git/git-ancestor'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_entry_adopt_branch } from './run-entry-adopt-branch'

vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_get_body_classified: vi.fn() },
}))

// The fixture has no `origin`; the fetch of a missing branch is the one remote call, answered as a failure.
vi.mock(import('#scripts/git/git-spawn'), async (import_original) => {
	const original = await import_original()

	return {
		git_spawn: {
			...original.git_spawn,
			read_remote: vi.fn().mockRejectedValue(new Error('no origin')),
		},
	}
})

// joshuafolkken/kit#9148, with real git: the lane entry takes in the commit the Issue body's
// adopt-branch row names. #9142's lane rebuilt a consultation session's wip work from the prose
// instead, because nothing carried the branch to the lane; what this asserts is git's own merge result.

const TIMEOUT_MS = 30_000
const WORKSPACE_PREFIX = 'kit-adopt-branch-'
const ISSUE = '1'
const WIP_BRANCH = 'wip/x'
const SHARED_FILE = 'shared.txt'
const IDENTITY_EMAIL = 'fixture@example.test'

const { git, MAIN_BRANCH } = git_fixture_workspace

const fixture: FixtureWorkspace & { root: string } = {
	workspace: '',
	root: '',
	previous_cwd: '',
	restore_environment: undefined,
}

async function commit_file(name: string, content: string): Promise<string> {
	await writeFile(path.join(fixture.root, name), content)
	await git(fixture.root, ['add', '--all'])
	await git(fixture.root, ['commit', '--no-verify', '-m', name])

	return await git(fixture.root, ['rev-parse', 'HEAD'])
}

// A wip branch off main with one commit, `adopted`, and a later one past it, `later`.
async function make_wip(): Promise<{ adopted: string; later: string }> {
	await git(fixture.root, ['switch', '-c', WIP_BRANCH])
	const adopted = await commit_file('adopted.txt', 'adopted\n')
	const later = await commit_file('later.txt', 'later\n')

	await git(fixture.root, ['switch', 'main'])

	return { adopted, later }
}

function give_body(row: string | undefined): void {
	const body = ['## 背景', '', ...(row === undefined ? [] : [row]), '- 種別: 非不具合'].join('\n')

	vi.mocked(git_gh_issue_read.issue_get_body_classified).mockResolvedValue({
		kind: 'read',
		text: body,
	})
}

function row_of(sha: string, branch: string = WIP_BRANCH): string {
	return `- 取り込むブランチ: ${branch} @ ${sha}`
}

async function head(): Promise<string> {
	return await git(fixture.root, ['rev-parse', 'HEAD'])
}

async function contains(sha: string): Promise<boolean> {
	return await git_ancestor.is_ancestor(sha, 'HEAD')
}

// `adopt` merges through `git_spawn`, which takes this process's environment rather than the fixture's
// `-c` options, so the identity and the unsigned commit ride on the environment for the test.
function stub_identity(): void {
	vi.stubEnv('GIT_AUTHOR_NAME', git_fixture_workspace.AUTHOR_NAME)
	vi.stubEnv('GIT_AUTHOR_EMAIL', IDENTITY_EMAIL)
	vi.stubEnv('GIT_COMMITTER_NAME', git_fixture_workspace.AUTHOR_NAME)
	vi.stubEnv('GIT_COMMITTER_EMAIL', IDENTITY_EMAIL)
	vi.stubEnv('GIT_CONFIG_COUNT', '1')
	vi.stubEnv('GIT_CONFIG_KEY_0', 'commit.gpgsign')
	vi.stubEnv('GIT_CONFIG_VALUE_0', 'false')
}

beforeEach(async () => {
	const opened = git_fixture_workspace.open_workspace(WORKSPACE_PREFIX)

	fixture.workspace = opened.workspace
	fixture.previous_cwd = opened.previous_cwd
	fixture.restore_environment = opened.restore_environment
	fixture.root = path.join(fixture.workspace, 'repository')

	await git(fixture.workspace, ['init', MAIN_BRANCH, 'repository'])
	await commit_file(SHARED_FILE, 'base\n')
	process.chdir(fixture.root)
	stub_identity()
}, TIMEOUT_MS)

afterEach(async () => {
	vi.unstubAllEnvs()
	await git_fixture_workspace.close_workspace(fixture)
})

describe('run_entry_adopt_branch.adopt — nothing to take in', () => {
	it(
		'leaves the tree alone without a row, or when HEAD already holds the commit',
		async () => {
			const before = await head()

			give_body(undefined)
			await expect(run_entry_adopt_branch.adopt(ISSUE)).resolves.toBeUndefined()
			give_body(row_of(before))
			await expect(run_entry_adopt_branch.adopt(ISSUE)).resolves.toBeUndefined()
			expect(await head()).toBe(before)
		},
		TIMEOUT_MS,
	)

	it(
		'stops on a malformed row',
		async () => {
			give_body(`- 取り込むブランチ: ${WIP_BRANCH}`)

			await expect(run_entry_adopt_branch.adopt(ISSUE)).resolves.toHaveProperty('report')
		},
		TIMEOUT_MS,
	)

	it(
		'stops when the Issue body cannot be read rather than reading it as no row',
		async () => {
			vi.mocked(git_gh_issue_read.issue_get_body_classified).mockResolvedValue({ kind: 'missing' })

			const stop = await run_entry_adopt_branch.adopt(ISSUE)

			expect(stop?.report).toContain(`could not read #${ISSUE}'s body`)
		},
		TIMEOUT_MS,
	)
})

describe('run_entry_adopt_branch.adopt — refusals', () => {
	it(
		'stops naming the branch and commit when the branch is neither here nor on origin',
		async () => {
			const { adopted } = await make_wip()

			await git(fixture.root, ['branch', '-D', WIP_BRANCH])
			give_body(row_of(adopted))

			const stop = await run_entry_adopt_branch.adopt(ISSUE)

			expect(stop?.report).toContain(WIP_BRANCH)
			expect(stop?.report).toContain(adopted)
		},
		TIMEOUT_MS,
	)

	it(
		'stops when the commit is not on the named branch',
		async () => {
			await make_wip()
			const before = await head()

			await git(fixture.root, ['switch', '-c', 'other'])
			const elsewhere = await commit_file('elsewhere.txt', 'x\n')

			await git(fixture.root, ['switch', 'main'])
			give_body(row_of(elsewhere))

			await expect(run_entry_adopt_branch.adopt(ISSUE)).resolves.toHaveProperty('report')
			expect(await head()).toBe(before)
		},
		TIMEOUT_MS,
	)
})

describe('run_entry_adopt_branch.adopt — merging', () => {
	it(
		'merges the named commit, not the branch tip that moved past it',
		async () => {
			const { adopted, later } = await make_wip()

			give_body(row_of(adopted))

			await expect(run_entry_adopt_branch.adopt(ISSUE)).resolves.toBeUndefined()
			expect(await contains(adopted)).toBe(true)
			expect(await contains(later)).toBe(false)
		},
		TIMEOUT_MS,
	)
})

describe('run_entry_adopt_branch.adopt — merge shape', () => {
	it(
		'records a merge commit rather than fast-forwarding onto the wip commit',
		async () => {
			const { adopted } = await make_wip()

			give_body(row_of(adopted))

			await expect(run_entry_adopt_branch.adopt(ISSUE)).resolves.toBeUndefined()
			expect(await head()).not.toBe(adopted)
			expect(await git(fixture.root, ['rev-parse', 'HEAD^2'])).toBe(adopted)
		},
		TIMEOUT_MS,
	)

	it(
		'aborts a conflicting merge and stops',
		async () => {
			await git(fixture.root, ['switch', '-c', WIP_BRANCH])
			const adopted = await commit_file(SHARED_FILE, 'wip\n')

			await git(fixture.root, ['switch', 'main'])
			const before = await commit_file(SHARED_FILE, 'main\n')

			give_body(row_of(adopted))

			await expect(run_entry_adopt_branch.adopt(ISSUE)).resolves.toHaveProperty('report')
			expect(existsSync(path.join(fixture.root, '.git', 'MERGE_HEAD'))).toBe(false)
			expect(await head()).toBe(before)
		},
		TIMEOUT_MS,
	)
})
