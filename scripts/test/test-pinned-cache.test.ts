import { mkdtempSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { base_tree } from '#scripts/git/base-tree'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_cache, type LoadedCache } from './test-pinned-cache'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_pinned_logic } from './test-pinned-logic'
import { test_red } from './test-red'
import { test_unit_guard } from './test-unit-guard'

// joshuafolkken/kit#4706: `josh test:pinned` (and `josh run:review`, which calls the same `run`) reuses
// a hunk's stored verdict while the hunk and the tests that ran for it are unchanged, and spreads the
// rest over as many trees as the worker budget allows — with the verdicts a serial run gives.

const RUN_TIMEOUT = 240_000
const CACHE_NAME = 'josh-test-pinned-verdicts.json'
const { DRIVER_FILE, CHANGED_DRIVER, build_change_branch, git, write } = test_pinned_fixture
const EXTRA_TEST = 'extra.test.ts'

// A test file that reaches none of the fixture's code.
function extra_test(title: string): string {
	return `import { it } from 'vitest'\n\nit('${title}', () => {})\n`
}

const fixture: { current?: FixtureWorkspace } = {}

beforeEach(() => {
	const workspace = git_fixture_workspace.open_workspace('test-pinned-cache-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
})

afterEach(async () => {
	vi.restoreAllMocks()
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

async function run_report(): ReturnType<typeof test_pinned.run> {
	return await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)
}

async function drop_cache(): Promise<void> {
	await rm(await git(['rev-parse', '--git-path', CACHE_NAME]), { force: true })
}

describe('test_pinned.run with a stored verdict', () => {
	it(
		'answers the same report on a second run over the same tree without starting vitest',
		async () => {
			await build_change_branch()
			const first = await run_report()
			const runs = vi.spyOn(test_red, 'run_in')

			const second = await run_report()

			expect(runs).not.toHaveBeenCalled()
			expect(second).toEqual(first)
		},
		RUN_TIMEOUT,
	)

	it(
		'checks again only the hunk whose lines changed',
		async () => {
			await build_change_branch()
			await run_report()
			await write(DRIVER_FILE, CHANGED_DRIVER.replace("'--driver'", "'--drive'"))
			const runs = vi.spyOn(test_red, 'run_in')

			const report = await run_report()

			expect(runs).toHaveBeenCalledTimes(1)
			expect(report.unpinned.map((hunk) => test_pinned_logic.location(hunk))).toEqual([
				`${DRIVER_FILE}:6`,
			])
		},
		RUN_TIMEOUT,
	)
})

describe('test_pinned.run after a test file is added', () => {
	it(
		'checks every hunk again',
		async () => {
			await build_change_branch()
			await run_report()
			await write(EXTRA_TEST, extra_test('runs'))
			const runs = vi.spyOn(test_red, 'run_in')

			await run_report()

			expect(runs).toHaveBeenCalledTimes(2)
		},
		RUN_TIMEOUT,
	)
})

describe('test_pinned.run over parallel trees', () => {
	it(
		'gives the verdicts of a serial run when the budget spreads the hunks over two trees',
		async () => {
			await build_change_branch()
			const share = vi.spyOn(test_unit_guard, 'vitest_share').mockResolvedValue(1)
			const trees = vi.spyOn(base_tree, 'with_tree')
			const serial = await run_report()

			await drop_cache()
			share.mockResolvedValue(4)

			const parallel = await run_report()

			expect(trees).toHaveBeenCalledTimes(2 + 1)
			expect(parallel).toEqual(serial)
		},
		RUN_TIMEOUT,
	)
})

// Two entries, each run with its own test file, under test contents that have not changed since.
async function cache_of(): Promise<LoadedCache> {
	const red = await test_pinned_cache.entry_for('red', ['a.test.ts'])
	const green = await test_pinned_cache.entry_for('green', ['b.test.ts'])

	return { file: '', test_set: '', test_contents: '', entries: { red, green }, is_unchanged: true }
}

// The freshness check against the work tree's own test files, without a run.
describe('test_pinned_cache.known', () => {
	const directory = { current: '' }

	beforeEach(async () => {
		directory.current = mkdtempSync(path.join(tmpdir(), 'test-pinned-known-'))
		process.chdir(directory.current)
		await writeFile('a.test.ts', 'a')
		await writeFile('b.test.ts', 'b')
	})

	afterEach(async () => {
		await rm(directory.current, { recursive: true, force: true })
	})

	it('drops only the entry whose test file changed', async () => {
		const cache = await cache_of()

		await writeFile('a.test.ts', 'a, changed')

		const known = await test_pinned_cache.known(cache, ['red', 'green', 'absent'])

		expect(known).toEqual([undefined, cache.entries['green'], undefined])
	})

	it('keeps a red entry but drops a green one once any test file changed', async () => {
		const cache = { ...(await cache_of()), is_unchanged: false }

		const known = await test_pinned_cache.known(cache, ['red', 'green'])

		expect(known).toEqual([cache.entries['red'], undefined])
	})
})

describe('test_pinned.run after an existing test file changed', () => {
	it(
		'checks again an unpinned hunk, which any test may have come to reach',
		async () => {
			await build_change_branch()
			await write(EXTRA_TEST, extra_test('runs'))
			const first = await run_report()

			await write(EXTRA_TEST, extra_test('runs again'))
			const runs = vi.spyOn(test_red, 'run_in')

			await run_report()

			expect(first.unpinned).toHaveLength(1)
			expect(runs).toHaveBeenCalledTimes(1)
		},
		RUN_TIMEOUT,
	)
})
