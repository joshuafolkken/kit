import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_cache } from './test-pinned-cache'
import { test_pinned_cache_logic } from './test-pinned-cache-logic'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_pinned_snapshot } from './test-pinned-snapshot'
import { test_red } from './test-red'

const { build_change_branch, git, write, DRIVER_FILE, TEST_FILE, CHANGED_DRIVER } =
	test_pinned_fixture
const fixture: { current?: FixtureWorkspace } = {}
const DELETED = 'deleted.txt'
const UNTRACKED = 'untracked.txt'
const LATER = 'later content\n'
const UNTRACKED_CONTENT = 'untracked\n'
const FAILURE = 'probe failed'
const IGNORED = 'ignored.js'
const PORCELAIN = '--porcelain'

beforeEach(async () => {
	fixture.current = git_fixture_workspace.open_workspace('pinned-snapshot-test-')
	process.chdir(fixture.current.workspace)
	await build_change_branch()
})

afterEach(async () => {
	vi.restoreAllMocks()
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

async function staged_and_deleted(): Promise<void> {
	await write(DELETED, 'tracked\n')
	await git(['add', DELETED])
	await git(['commit', '-m', 'deletion fixture'])
	await git(['add', DRIVER_FILE])
	await write(DRIVER_FILE, `${CHANGED_DRIVER}\n// Worktree only.\n`)
	await rm(DELETED)
	await write(UNTRACKED, UNTRACKED_CONTENT)
}

async function original_state(): Promise<string> {
	return JSON.stringify(
		await Promise.all([
			git(['status', PORCELAIN]),
			git(['ls-files', '--stage']),
			git(['diff', '--binary']),
			git(['diff', '--cached', '--binary']),
			git(['worktree', 'list', PORCELAIN]),
		]),
	)
}

it.each([false, true])(
	'preserves partial staging, deletion and untracked state on failure=%s',
	async (fails) => {
		await staged_and_deleted()
		const before = await original_state()
		const source = await readFile(DRIVER_FILE, 'utf8')
		const action = test_pinned_snapshot.with_snapshot(async () => {
			expect(await readFile(DRIVER_FILE, 'utf8')).toBe(source)
			expect(await readFile(UNTRACKED, 'utf8')).toBe(UNTRACKED_CONTENT)
			await expect(readFile(DELETED)).rejects.toThrow()
			if (fails) throw new Error(FAILURE)
		})

		if (fails) await expect(action).rejects.toThrow(FAILURE)
		else await action
		expect(await original_state()).toBe(before)
	},
)

function move_source(root: string): void {
	const { load } = test_pinned_cache

	vi.spyOn(test_pinned_cache, 'load').mockImplementation(async (...args) => {
		await writeFile(path.join(root, DRIVER_FILE), LATER)
		await writeFile(path.join(root, TEST_FILE), LATER)
		const cache = await load(...args)

		expect(cache.contents.get(DRIVER_FILE)).toBe(CHANGED_DRIVER)
		expect(cache.test_digests.get(TEST_FILE)).toBe(
			test_pinned_cache_logic.digest_of(test_pinned_fixture.DEFAULT_PATH_TEST),
		)

		return cache
	})
}

function capture_copies(): Array<string> {
	const copies: Array<string> = []

	vi.spyOn(test_red, 'probe_in').mockImplementation(async (tree) => {
		copies.push(await readFile(path.join(tree.tree, TEST_FILE), 'utf8'))

		return { verdict: 'green', failed: [], ran: 1 }
	})

	return copies
}

it('uses starting hunks, cache inputs and probe copies after the source moves, without a retry', async () => {
	const root = process.cwd()
	const hash = test_pinned_snapshot.current_hash(root)
	const copies = capture_copies()

	move_source(root)

	const report = await test_pinned.run(20)

	expect(test_pinned_cache.load).toHaveBeenCalledTimes(1)
	expect(copies).toEqual([
		test_pinned_fixture.DEFAULT_PATH_TEST,
		test_pinned_fixture.DEFAULT_PATH_TEST,
	])
	expect(report).toMatchObject({ tree_hash: hash, is_stale: true })
	expect(report.unpinned[0]?.new_lines).toContain("\treturn code === 0 ? 'merged' : 'busy'")
	expect(await readFile(path.join(root, DRIVER_FILE), 'utf8')).toBe(LATER)
})

it('reuses the original checkout cache on the same snapshot without starting another probe', async () => {
	const probes = vi
		.spyOn(test_red, 'probe_in')
		.mockResolvedValue({ verdict: 'green', failed: [], ran: 1 })
	const first = await test_pinned.run(20)

	probes.mockClear()

	expect(await test_pinned.run(20)).toEqual(first)
	expect(probes).not.toHaveBeenCalled()
})

it('changes its identity for index-only edits while the worktree content stays the same', async () => {
	const before = test_pinned_snapshot.current_hash(process.cwd())

	await git(['add', DRIVER_FILE])

	expect(test_pinned_snapshot.current_hash(process.cwd())).not.toBe(before)
})

async function force_add_ignored(): Promise<string | undefined> {
	await write('.gitignore', `node_modules\n${IGNORED}\n`)
	await write(IGNORED, CHANGED_DRIVER)
	await git(['add', '--force', IGNORED])

	return test_pinned_snapshot.current_hash(process.cwd())
}

it('probes a force-added ignored source and includes its worktree content in the identity', async () => {
	const staged_hash = await force_add_ignored()

	await write(IGNORED, `${CHANGED_DRIVER}\n// Worktree only.\n`)
	const hash = test_pinned_snapshot.current_hash(process.cwd())
	const before = await original_state()
	const report = await test_pinned.run(0)

	expect(hash).not.toBe(staged_hash)
	expect(report).toMatchObject({ tree_hash: hash, is_stale: false })
	expect(report.unchecked.some((hunk) => hunk.file === IGNORED)).toBe(true)
	expect(await original_state()).toBe(before)
})
