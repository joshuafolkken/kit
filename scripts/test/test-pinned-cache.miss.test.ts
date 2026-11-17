import { writeFile } from 'node:fs/promises'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { test_pinned_cache, type LoadedCache } from './test-pinned-cache'
import type { StoredVerdict } from './test-pinned-cache-logic'
import { test_pinned_carry } from './test-pinned-carry'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_pinned_logic } from './test-pinned-logic'

// joshuafolkken/kit#7804: `test_pinned_cache.misses` answers, per hunk, why the cache did not hold its
// verdict — none stored, or the key that no longer reads the same.
const CACHE_FILE = 'verdicts.json'
const OTHER = 'other'
const { build_change_branch, git, DRIVER_FILE } = test_pinned_fixture
const fixture: { current?: FixtureWorkspace } = {}

beforeEach(async () => {
	const workspace = git_fixture_workspace.open_workspace('test-pinned-cache-miss-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
	await build_change_branch()
})

afterEach(async () => {
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

async function load(): Promise<LoadedCache> {
	const diff = await git(['diff', '-U0', 'main', '--', DRIVER_FILE])

	return await test_pinned_cache.load('main', test_pinned_logic.parse_hunks(diff), CACHE_FILE)
}

async function misses_of(cache: LoadedCache): Promise<Array<unknown>> {
	const keys = test_pinned_carry.keys(cache, cache.hunks)

	return await test_pinned_cache.misses(
		cache,
		keys,
		cache.hunks.map((hunk) => hunk.file),
	)
}

// The cache written under `written` with `entry` stored for the first hunk only, read back.
async function with_first(
	written: Pick<LoadedCache, 'change' | 'test_contents'>,
	entry: StoredVerdict,
): Promise<LoadedCache> {
	const before = await load()
	const [first = ''] = test_pinned_carry.keys(before, before.hunks)
	const entries = { [first]: entry }

	await writeFile(CACHE_FILE, JSON.stringify({ ...written, entries }))

	return await load()
}

describe('test_pinned_cache.misses', () => {
	it('answers unregistered for every hunk while no verdict is stored', async () => {
		const cache = await load()

		expect(await misses_of(cache)).toEqual(cache.hunks.map(() => 'unregistered'))
	})

	it('answers change for a red verdict stored under another code change', async () => {
		const now = await load()
		const cache = await with_first(
			{ change: OTHER, test_contents: now.test_contents },
			{ verdict: 'red', tests: {} },
		)
		const [first, ...rest] = await misses_of(cache)

		expect(first).toBe('change')
		expect(rest.every((reason) => reason === 'unregistered')).toBe(true)
	})

	it('answers nothing for a verdict the tree-wide digests still hold', async () => {
		const now = await load()
		const cache = await with_first(now, { verdict: 'green', tests: {} })
		const [first] = await misses_of(cache)

		expect(first).toBeUndefined()
	})

	it('answers basis for a green verdict whose basis read now differs', async () => {
		const now = await load()
		const cache = await with_first(
			{ change: now.change, test_contents: OTHER },
			{ verdict: 'green', tests: {}, basis: OTHER },
		)
		const [first] = await misses_of(cache)

		expect(first).toBe('basis')
	})
})
