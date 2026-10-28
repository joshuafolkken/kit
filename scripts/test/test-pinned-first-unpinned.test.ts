import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_pinned_logic } from './test-pinned-logic'
import { test_pinned_pool } from './test-pinned-pool'
import { test_red } from './test-red'

// joshuafolkken/kit#5153: a `--first-unpinned` run starts no probe once one is unpinned, reports the
// hunks it left as cut, and keeps the verdict it reached for the next run.

const RUN_TIMEOUT = 240_000
const { build_change_branch, write } = test_pinned_fixture
const TSCONFIG_CONTENT =
	'{ "compilerOptions": { "allowJs": true, "moduleResolution": "bundler", "module": "esnext" } }\n'

const fixture: { current?: FixtureWorkspace } = {}

beforeEach(() => {
	const workspace = git_fixture_workspace.open_workspace('test-pinned-first-unpinned-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
})

afterEach(async () => {
	vi.restoreAllMocks()
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

// One lane, and every probe answers green, so the first probe is unpinned.
async function build_green(): Promise<MockInstance<typeof test_red.probe_in>> {
	await build_change_branch()
	await write('tsconfig.json', TSCONFIG_CONTENT)
	vi.spyOn(test_pinned_pool, 'lane_plan').mockReturnValue({ lanes: 1, workers: 1 })

	return vi.spyOn(test_red, 'probe_in').mockResolvedValue({ verdict: 'green', failed: [], ran: 1 })
}

describe('test_pinned.run with is_first_unpinned', () => {
	it(
		'stops after the first unpinned hunk, and the next run probes only the hunk it left',
		async () => {
			const runs = await build_green()
			const first = await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS, true)

			expect([runs.mock.calls.length, first.cut?.length]).toEqual([1, 1])
			expect(await test_pinned.held_report(test_pinned_logic.DEFAULT_MAX_HUNKS)).toBeUndefined()
			runs.mockClear()
			const second = await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)

			expect([runs.mock.calls.length, second.cut]).toEqual([1, undefined])
		},
		RUN_TIMEOUT,
	)

	it(
		'probes every hunk without the flag',
		async () => {
			const runs = await build_green()
			const report = await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)

			expect([runs.mock.calls.length, report.unpinned.length, report.cut]).toEqual([
				2,
				2,
				undefined,
			])
		},
		RUN_TIMEOUT,
	)
})
