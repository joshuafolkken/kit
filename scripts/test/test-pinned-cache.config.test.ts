import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_pinned_logic } from './test-pinned-logic'

// joshuafolkken/kit#7521: a `no-test` verdict reached while the vitest config collected none of the
// tests reaching the hunk is not reused once the config widens its `include` — the test runner's
// configuration is part of what the verdict rests on, as a test file is.

const RUN_TIMEOUT = 240_000
const CONFIG_FILE = 'vitest.config.js'
const NARROW_CONFIG = `export default { test: { include: ['none/**/*.test.ts'], passWithNoTests: true } }\n`
const WIDE_CONFIG = `export default { test: { passWithNoTests: true } }\n`
const { DRIVER_FILE, build_change_branch, write } = test_pinned_fixture
const UNPINNED_HUNK = `${DRIVER_FILE}:6`

const fixture: { current?: FixtureWorkspace } = {}

beforeEach(() => {
	const workspace = git_fixture_workspace.open_workspace('test-pinned-cache-config-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
})

afterEach(async () => {
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

// The unpinned hunks in the driver, where the fixture's test reaches.
async function driver_unpinned(): Promise<Array<string>> {
	const report = await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)

	return report.unpinned
		.filter((hunk) => hunk.file === DRIVER_FILE)
		.map((hunk) => test_pinned_logic.location(hunk))
}

describe('test_pinned.run after the test runner config widened its include', () => {
	it(
		'probes a hunk stored as no-test again, and reports only the hunk no test pins',
		async () => {
			await build_change_branch()
			await write(CONFIG_FILE, NARROW_CONFIG)
			const narrow = await driver_unpinned()

			await write(CONFIG_FILE, WIDE_CONFIG)
			const wide = await driver_unpinned()

			expect(narrow).toHaveLength(2)
			expect(wide).toEqual([UNPINNED_HUNK])
		},
		RUN_TIMEOUT,
	)
})
