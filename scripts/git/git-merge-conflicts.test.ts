import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { git_fixture_workspace, type FixtureWorkspace } from './git-fixture-workspace'
import { git_merge_conflicts } from './git-merge-conflicts'

// joshuafolkken/kit#4348, with real git: whether two changes conflict is a property of git's merge,
// which a mocked git would only echo back. Ours is always left uncommitted, as `josh ship` meets it.

const TIMEOUT_MS = 30_000
const WORKSPACE_PREFIX = 'kit-merge-conflicts-'
const MAIN = 'main'
const OURS = 'ours'
const THEIRS = 'theirs'
const LATER = 'later'
const SHARED_FILE = 'shared.ts'
const ADDED_FILE = '4348-comment-rounds.md'
const ROUND_CONTENT = 'round 1\n'
const BASE_VALUE = 'export const value = 1\n'
const OURS_VALUE = 'export const value = 2\n'
const THEIRS_VALUE = 'export const value = 3\n'
const BASE_LINES = 'first\nsecond\nthird\nfourth\nfifth\n'

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

// `theirs` commits `content` to `relative`; `ours` is then checked out with nothing committed yet.
async function theirs_commits(relative: string, content: string): Promise<void> {
	await git(fixture.workspace, ['switch', '-c', THEIRS, MAIN])
	await write(relative, content)
	await commit_all(THEIRS)
	await git(fixture.workspace, ['switch', '-c', OURS, MAIN])
}

function conflicts(paths: ReadonlyArray<string>): ReadonlyArray<string> | undefined {
	return git_merge_conflicts.working_tree_conflicts(THEIRS, paths, fixture.workspace)
}

beforeEach(async () => {
	Object.assign(fixture, git_fixture_workspace.open_workspace(WORKSPACE_PREFIX))
	await git(fixture.workspace, ['init', MAIN_BRANCH])
	await write(SHARED_FILE, BASE_VALUE)
	await commit_all('base')
}, TIMEOUT_MS)

afterEach(async () => {
	await git_fixture_workspace.close_workspace(fixture)
}, TIMEOUT_MS)

describe('git_merge_conflicts.working_tree_conflicts — clean merges', () => {
	it(
		'answers no conflict for an untracked file the other branch added identically',
		async () => {
			await theirs_commits(ADDED_FILE, ROUND_CONTENT)
			await write(ADDED_FILE, ROUND_CONTENT)

			expect(conflicts([ADDED_FILE])).toStrictEqual([])
		},
		TIMEOUT_MS,
	)

	it(
		'answers no conflict where the two changes touch different lines',
		async () => {
			await write(SHARED_FILE, BASE_LINES)
			await commit_all('lines')
			await theirs_commits(SHARED_FILE, BASE_LINES.replace('first', 'one'))
			await write(SHARED_FILE, BASE_LINES.replace('fifth', 'five'))

			expect(conflicts([SHARED_FILE])).toStrictEqual([])
		},
		TIMEOUT_MS,
	)
})

function first_line_as(line: string): string {
	return `${line}${BASE_LINES.slice(BASE_LINES.indexOf('\n'))}`
}

// `later` changes the line `theirs` changed once more, as the default branch moves on during a merge.
async function later_changes_it_again(): Promise<void> {
	await git(fixture.workspace, ['switch', '-c', LATER, THEIRS])
	await write(SHARED_FILE, first_line_as('two'))
	await commit_all(LATER)
	await git(fixture.workspace, ['switch', OURS])
}

// Both branches change the first line; `ours` commits its change, begins merging `theirs`, and leaves
// a resolution unlike either side uncommitted, as a resumed lane meets it.
async function resolve_merge_of_theirs(): Promise<void> {
	await write(SHARED_FILE, BASE_LINES)
	await commit_all('lines')
	await theirs_commits(SHARED_FILE, first_line_as('one'))
	await later_changes_it_again()
	await write(SHARED_FILE, first_line_as('uno'))
	await commit_all(OURS)
	await git(fixture.workspace, ['merge', '--no-commit', '--strategy', 'ours', THEIRS])
	await write(SHARED_FILE, first_line_as('one and uno'))
}

describe('git_merge_conflicts.working_tree_conflicts — a merge in progress', () => {
	it(
		'answers no conflict for a resolution left uncommitted in a merge of the other branch',
		async () => {
			await resolve_merge_of_theirs()

			expect(conflicts([SHARED_FILE])).toStrictEqual([])
		},
		TIMEOUT_MS,
	)

	it(
		'lists the resolved line where the other branch has changed it again since the merge began',
		async () => {
			await resolve_merge_of_theirs()

			expect(
				git_merge_conflicts.working_tree_conflicts(LATER, [SHARED_FILE], fixture.workspace),
			).toStrictEqual([SHARED_FILE])
		},
		TIMEOUT_MS,
	)
})

describe('git_merge_conflicts.working_tree_conflicts — conflicts', () => {
	it(
		'lists an uncommitted change to the line the other branch changed differently',
		async () => {
			await theirs_commits(SHARED_FILE, THEIRS_VALUE)
			await write(SHARED_FILE, OURS_VALUE)

			expect(conflicts([SHARED_FILE])).toStrictEqual([SHARED_FILE])
		},
		TIMEOUT_MS,
	)

	it(
		'lists an untracked file the other branch added differently',
		async () => {
			await theirs_commits(ADDED_FILE, ROUND_CONTENT)
			await write(ADDED_FILE, 'round 2\n')

			expect(conflicts([ADDED_FILE])).toStrictEqual([ADDED_FILE])
		},
		TIMEOUT_MS,
	)

	it(
		'lists a file deleted here that the other branch changed',
		async () => {
			await theirs_commits(SHARED_FILE, THEIRS_VALUE)
			await rm(path.join(fixture.workspace, SHARED_FILE))

			expect(conflicts([SHARED_FILE])).toStrictEqual([SHARED_FILE])
		},
		TIMEOUT_MS,
	)
})

describe('git_merge_conflicts.working_tree_conflicts — reads only', () => {
	it(
		'leaves the index and the working tree as they were',
		async () => {
			await theirs_commits(SHARED_FILE, THEIRS_VALUE)
			await write(SHARED_FILE, OURS_VALUE)
			const status = ['status', '--porcelain']
			const before = await git(fixture.workspace, status)

			conflicts([SHARED_FILE])

			expect(await git(fixture.workspace, status)).toBe(before)
		},
		TIMEOUT_MS,
	)

	it(
		'answers undefined when the other commit cannot be resolved',
		() => {
			expect(
				git_merge_conflicts.working_tree_conflicts('missing', [SHARED_FILE], fixture.workspace),
			).toBeUndefined()
		},
		TIMEOUT_MS,
	)
})
