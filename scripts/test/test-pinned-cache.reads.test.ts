import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { git_spawn } from '#scripts/git/git-spawn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_cache, type LoadedCache } from './test-pinned-cache'
import { test_pinned_carry } from './test-pinned-carry'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_pinned_logic } from './test-pinned-logic'

// joshuafolkken/kit#9014: the cache reads the tree's listing once per read, and reuses the base's
// commit within one run only where the base is that commit.

const CACHE_FILE = 'verdicts.json'
const LISTING = ['ls-files', '-coz', '--exclude-standard']
const { build_change_branch, git, DRIVER_FILE } = test_pinned_fixture
const fixture: { current?: FixtureWorkspace } = {}

beforeEach(async () => {
	const workspace = git_fixture_workspace.open_workspace('test-pinned-cache-reads-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
	await build_change_branch()
})

afterEach(async () => {
	vi.restoreAllMocks()
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

async function load(base: string): Promise<LoadedCache> {
	const diff = await git(['diff', '-U0', base, '--', DRIVER_FILE])

	return await test_pinned_cache.load(base, test_pinned_logic.parse_hunks(diff), CACHE_FILE)
}

async function main_commit(): Promise<string> {
	const commit = await git(['rev-parse', 'main'])

	return commit.trim()
}

function count(spy: { mock: { calls: Array<[ReadonlyArray<string>, ...Array<unknown>]> } }): {
	listings: number
	commit_reads: number
} {
	const calls = spy.mock.calls.map(([args]) => args.join(' '))

	return {
		listings: calls.filter((call) => call === LISTING.join(' ')).length,
		commit_reads: calls.filter((call) => call.startsWith('rev-parse --verify')).length,
	}
}

// Runs the steadiness check `record` makes before it writes, and counts its reads.
async function settle_reads(cache: LoadedCache): Promise<ReturnType<typeof count>> {
	const spy = vi.spyOn(git_spawn, 'read')

	await test_pinned_cache.writer(cache, test_pinned_carry.keys(cache, cache.hunks)).record([])

	return count(spy)
}

describe('test_pinned_cache reads', () => {
	it('lists the work tree once per load', async () => {
		const spy = vi.spyOn(git_spawn, 'read')

		await load('main')

		expect(count(spy)).toStrictEqual({ listings: 1, commit_reads: 1 })
	})

	it('reuses the commit in the steadiness check when the base is that commit', async () => {
		const cache = await load(await main_commit())

		expect(await settle_reads(cache)).toStrictEqual({ listings: 1, commit_reads: 0 })
	})

	it('reads the commit again in the steadiness check when the base is a ref name', async () => {
		const cache = await load('main')

		expect(await settle_reads(cache)).toStrictEqual({ listings: 1, commit_reads: 1 })
	})

	it('reads the commit again on a second load, carrying nothing across runs', async () => {
		const base = await main_commit()

		await load(base)
		const spy = vi.spyOn(git_spawn, 'read')

		await load(base)

		expect(count(spy).commit_reads).toBe(1)
	})
})
