import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_red } from './test-red'

const RUN_TIMEOUT = 240_000
const fixture: { current?: FixtureWorkspace } = {}

beforeEach(async () => {
	const workspace = git_fixture_workspace.open_workspace('test-pinned-continue-run-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
	await test_pinned_fixture.build_change_branch()
	await test_pinned_fixture.write('tsconfig.json', '{"compilerOptions":{"allowJs":true}}\n')
})

afterEach(async () => {
	vi.restoreAllMocks()
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

// joshuafolkken/kit#8975: a cut run and its continuation together probe one uncut run's range, so
// the continuation probes no hunk the cut run left past its cap.
describe('test_pinned.run_continued after a cut run', () => {
	it(
		'probes only the cut run range and leaves the hunks past its cap unchecked',
		async () => {
			const runs = vi
				.spyOn(test_red, 'probe_in')
				.mockResolvedValue({ verdict: 'green', failed: [], ran: 1 })
			const cut = await test_pinned.run(1, true)

			expect(runs).toHaveBeenCalledTimes(1)
			runs.mockClear()
			const continued = await test_pinned.run_continued(1)

			expect(runs).not.toHaveBeenCalled()
			expect(continued.unpinned).toEqual(cut.unpinned)
			expect(continued.unchecked).toHaveLength(cut.unchecked.length)
		},
		RUN_TIMEOUT,
	)

	it(
		'advances to the next hunk on a plain rerun, as the carry does',
		async () => {
			const runs = vi
				.spyOn(test_red, 'probe_in')
				.mockResolvedValue({ verdict: 'green', failed: [], ran: 1 })

			await test_pinned.run(1, true)
			runs.mockClear()
			await test_pinned.run(1)

			expect(runs).toHaveBeenCalledTimes(1)
		},
		RUN_TIMEOUT,
	)
})
