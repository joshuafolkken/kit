import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_pinned_ledger } from './test-pinned-ledger'
import { test_pinned_logic } from './test-pinned-logic'
import { test_red } from './test-red'

// joshuafolkken/kit#5503: a hunk whose file reaches more test files than the cap is reported unchecked
// and never probed, by a fresh run and a cache-only read alike, and the run's ledger row counts it.

const RUN_TIMEOUT = 240_000
const { build_change_branch, write } = test_pinned_fixture
const TSCONFIG_CONTENT =
	'{ "compilerOptions": { "allowJs": true, "moduleResolution": "bundler", "module": "esnext" } }\n'

const fixture: { current?: FixtureWorkspace } = {}

beforeEach(() => {
	const workspace = git_fixture_workspace.open_workspace('test-pinned-cap-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
})

afterEach(async () => {
	vi.restoreAllMocks()
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

// The fixture's change under a cap of 0 test files, so every hunk whose file any test reaches is over it.
async function build_with_zero_cap(): Promise<void> {
	await build_change_branch()
	await write('tsconfig.json', TSCONFIG_CONTENT)
	const capped = test_pinned_logic.capped.bind(test_pinned_logic)

	vi.spyOn(test_pinned_logic, 'capped').mockImplementation((hunks, reach) =>
		capped(hunks, reach, 0),
	)
}

describe('test_pinned.run over the test-file cap', () => {
	it(
		'reports every reaching hunk unchecked, probes none of them and counts them in its row',
		async () => {
			await build_with_zero_cap()
			const row = vi.spyOn(test_pinned_ledger, 'record')
			const runs = vi.spyOn(test_red, 'probe_in')
			const report = await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)
			const over_cap = report.over_cap?.length ?? 0

			expect(over_cap).toBeGreaterThan(0)
			expect(report.unpinned).toEqual([])
			expect(runs).not.toHaveBeenCalled()
			expect(row.mock.calls.map(([skipped]) => skipped.over_cap)).toEqual([over_cap])
		},
		RUN_TIMEOUT,
	)

	it(
		'reports the same hunks unchecked from the cache alone',
		async () => {
			await build_with_zero_cap()
			const report = await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)
			const held = await test_pinned.held_report(test_pinned_logic.DEFAULT_MAX_HUNKS)

			expect(held?.over_cap).toEqual(report.over_cap)
		},
		RUN_TIMEOUT,
	)
})
