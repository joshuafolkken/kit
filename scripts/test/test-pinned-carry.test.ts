import { readFile } from 'node:fs/promises'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { test_pinned_cache, type LoadedCache } from './test-pinned-cache'
import { test_pinned_carry } from './test-pinned-carry'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_pinned_logic } from './test-pinned-logic'

const CARRY_FILE = '.git/josh-test-pinned-carry.json'
const { build_change_branch, git, write, DRIVER_FILE, CHANGED_DRIVER } = test_pinned_fixture
const fixture: { current?: FixtureWorkspace } = {}

beforeEach(async () => {
	const workspace = git_fixture_workspace.open_workspace('test-pinned-carry-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
	await build_change_branch()
})

afterEach(async () => {
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

async function load(): Promise<LoadedCache> {
	const diff = await git(['diff', '-U0', 'main', '--', DRIVER_FILE])

	return await test_pinned_cache.load('main', test_pinned_logic.parse_hunks(diff))
}

async function leave_pending(): Promise<LoadedCache> {
	const cache = await load()
	const split = await test_pinned_carry.select(cache, 1)

	test_pinned_carry.record(cache, split.unchecked)

	return cache
}

async function expect_first(cache: LoadedCache): Promise<void> {
	const selected = await test_pinned_carry.select(cache, 1)

	expect(selected.checked).toEqual([cache.hunks[0]])
}

describe('test_pinned_carry', () => {
	it('persists tree and hunk keys and prioritizes capped hunks without advancing on reads', async () => {
		const cache = await leave_pending()
		const text = await readFile(CARRY_FILE, 'utf8')
		const selected = await test_pinned_carry.select(cache, 1)

		expect(text).toContain(test_pinned_carry.keys(cache, cache.hunks).at(-1))
		expect(text).toContain('"tree":')
		expect(selected.checked).toEqual([cache.hunks[1]])
		expect(await test_pinned_carry.select(cache, 1)).toEqual(selected)
		expect(await readFile(CARRY_FILE, 'utf8')).toBe(text)
	})

	it('ignores pending keys after the tree changes', async () => {
		await leave_pending()
		await write('other.js', 'export const other = true\n')
		const cache = await load()

		await expect_first(cache)
	})

	it('never selects a removed hunk at its former location', async () => {
		await leave_pending()
		await write(
			DRIVER_FILE,
			CHANGED_DRIVER.replace(
				"return argv.includes('--driver') ? String(result.code) : result.token",
				'return result.token',
			).replace('token_of(result, argv)', 'token_of(result)'),
		)
		const cache = await load()

		await expect_first(cache)
	})

	it.each(['{', '{"tree": 1, "pending": []}'])('ignores corrupt records: %s', async (text) => {
		const cache = await load()

		await write(CARRY_FILE, text)

		await expect_first(cache)
	})
})
