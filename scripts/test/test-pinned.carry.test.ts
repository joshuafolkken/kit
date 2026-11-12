import { readFile, rm } from 'node:fs/promises'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_cache_logic } from './test-pinned-cache-logic'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_red } from './test-red'

const RUN_TIMEOUT = 240_000
const CARRY_FILE = '.git/josh-test-pinned-carry.json'
const CACHE_FILE = '.git/josh-test-pinned-verdicts.json'
const fixture: { current?: FixtureWorkspace } = {}

beforeEach(async () => {
	const workspace = git_fixture_workspace.open_workspace('test-pinned-carry-run-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
	await test_pinned_fixture.build_change_branch()
	await test_pinned_fixture.write('tsconfig.json', '{"compilerOptions":{"allowJs":true}}\n')
})

afterEach(async () => {
	vi.restoreAllMocks()
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

async function expect_read_unchanged(pending: string): Promise<void> {
	await test_pinned.cached(1)
	expect(await readFile(CARRY_FILE, 'utf8')).toBe(pending)
}

async function expect_drained(): Promise<void> {
	const report = await test_pinned.run(1)

	expect(report.unchecked).toEqual([])
}

async function expect_completed(): Promise<void> {
	const report = await test_pinned.run(1)

	expect(report.unchecked).toEqual([])
	expect(report.unpinned).toHaveLength(2)
}

describe('test_pinned capped carry', () => {
	it(
		'drains pending hunks across runs, preserves reads and reuses every held verdict',
		async () => {
			const runs = vi
				.spyOn(test_red, 'probe_in')
				.mockResolvedValue({ verdict: 'green', failed: [], ran: 1 })
			const first = await test_pinned.run(1)
			const pending = await readFile(CARRY_FILE, 'utf8')

			expect(first.unchecked).toHaveLength(1)
			await expect_read_unchanged(pending)
			await expect_completed()
			expect(runs).toHaveBeenCalledTimes(2)
			runs.mockClear()
			await expect_drained()
			expect(runs).not.toHaveBeenCalled()
		},
		RUN_TIMEOUT,
	)

	it(
		'records the prioritized hunk rather than the original first hunk after verdicts are lost',
		async () => {
			vi.spyOn(test_red, 'probe_in').mockResolvedValue({ verdict: 'green', failed: [], ran: 1 })
			await test_pinned.run(1)
			await rm(CACHE_FILE)
			const report = await test_pinned.run(1)
			const greens = test_pinned_cache_logic.greens_of(await readFile(CACHE_FILE, 'utf8'))

			expect(report.unpinned[0]?.new_start).toBe(6)
			expect(greens.map((green) => green.old_lines)).toEqual(
				report.unpinned.map((hunk) => hunk.old_lines),
			)
		},
		RUN_TIMEOUT,
	)
})
