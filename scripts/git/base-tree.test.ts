import { existsSync, lstatSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { base_tree, type BaseTree } from './base-tree'
import { git_fixture_workspace, type FixtureWorkspace } from './git-fixture-workspace'

// Drives `base_tree.with_tree` against a real git repository: what it promises — the commit's
// content, and a caller's checkout left as it was — is a property of the worktree git builds.

const PREFIX = 'base-tree-test-'
const NOTE_FILE = 'note.txt'
const BASE_NOTE = 'base\n'
const CHANGED_NOTE = 'changed\n'
const PORCELAIN = '--porcelain'
const FAILURE = 'the callback failed'

const fixture: { current?: FixtureWorkspace } = {}

async function git(arguments_: ReadonlyArray<string>): Promise<string> {
	return await git_fixture_workspace.git(process.cwd(), arguments_)
}

async function snapshot(): Promise<string> {
	const status = await git(['status', PORCELAIN])
	const head = await git(['rev-parse', 'HEAD'])
	const trees = await git(['worktree', 'list', PORCELAIN])

	return `${head}\n${status}\n${trees}`
}

// One commit holding the base note, then the note changed in the checkout and left uncommitted.
async function build_repository(): Promise<string> {
	await git(['init', git_fixture_workspace.MAIN_BRANCH])
	await writeFile(path.join(process.cwd(), NOTE_FILE), BASE_NOTE)
	await git(['add', '.'])
	await git(['commit', '-m', 'base'])
	await writeFile(path.join(process.cwd(), NOTE_FILE), CHANGED_NOTE)

	return await git(['rev-parse', 'HEAD'])
}

beforeEach(() => {
	const workspace = git_fixture_workspace.open_workspace(PREFIX)

	fixture.current = workspace
	process.chdir(workspace.workspace)
})

afterEach(async () => {
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

describe('base_tree.with_tree', () => {
	it("hands the callback the commit's content, not the checkout's", async () => {
		const commit = await build_repository()

		const note = await base_tree.with_tree(PREFIX, commit, async ({ tree }) =>
			readFileSync(path.join(tree, NOTE_FILE), 'utf8'),
		)

		expect(note).toBe(BASE_NOTE)
	})

	it("links the tree to the caller's node_modules beside a parent that is not the tree", async () => {
		const commit = await build_repository()

		const seen = await base_tree.with_tree(PREFIX, commit, async ({ parent, tree }) => ({
			is_linked: lstatSync(path.join(tree, base_tree.NODE_MODULES)).isSymbolicLink(),
			relative: path.relative(parent, tree),
		}))

		expect(seen.is_linked).toBe(true)
		expect(seen.relative.startsWith('..')).toBe(false)
		expect(seen.relative).not.toBe('')
	})
})

describe('base_tree.with_tree — what it leaves behind', () => {
	it('leaves the checkout, its worktree list and no temp directory behind', async () => {
		const commit = await build_repository()
		const before = await snapshot()

		const used = await base_tree.with_tree(PREFIX, commit, async (opened) => opened)

		expect(await snapshot()).toBe(before)
		expect(existsSync(used.parent)).toBe(false)
	})

	it('removes the tree when the callback throws, and passes the error on', async () => {
		const commit = await build_repository()
		const before = await snapshot()
		const opened: Array<BaseTree> = []

		const run = base_tree.with_tree(PREFIX, commit, async (tree) => {
			opened.push(tree)
			throw new Error(FAILURE)
		})

		await expect(run).rejects.toThrow(FAILURE)
		expect(await snapshot()).toBe(before)
		expect(opened.map((tree) => existsSync(tree.parent))).toStrictEqual([false])
	})
})
