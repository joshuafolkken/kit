import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_pinned_logic } from './test-pinned-logic'

// joshuafolkken/kit#7882 end to end: a changed `?:` whose false arm no test takes is reported by its
// arm, while its revert and its true arm, which the test takes, are pinned.

const RUN_TIMEOUT = 120_000
const { DEFAULT_PATH_TEST, DRIVER_FILE, TEST_FILE, build_base, git, link_node_modules, write } =
	test_pinned_fixture
const BRANCHED_DRIVER = `// A driver.
export function label(code) {
	return code === 0 ? 'merged' : 'busy'
}

export function token_of(result) {
	return result.token
}
`

const fixture: { current?: FixtureWorkspace } = {}

beforeEach(() => {
	const workspace = git_fixture_workspace.open_workspace('test-pinned-branches-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
})

afterEach(async () => {
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

// main already carries the branched driver and its test.
async function build_branched_main(): Promise<void> {
	await build_base()
	await write(DRIVER_FILE, BRANCHED_DRIVER)
	await write(TEST_FILE, DEFAULT_PATH_TEST)
	await git(['add', '.'])
	await git(['commit', '-m', 'branched'])
}

it(
	'reports the changed branch arm no test takes by its file, line and arm',
	async () => {
		await build_base()
		await git(['switch', '-c', 'change'])
		await write(DRIVER_FILE, BRANCHED_DRIVER)
		await write(TEST_FILE, DEFAULT_PATH_TEST)
		await link_node_modules()

		const report = await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)

		expect(report.unpinned.map((hunk) => test_pinned_logic.location(hunk))).toEqual([
			`${DRIVER_FILE}:3 ?: false branch`,
		])
		expect(report.unchecked).toEqual([])
	},
	RUN_TIMEOUT,
)

it(
	'probes no arm of a branch whose line changed only in a comment, which emits the same code',
	async () => {
		await build_branched_main()
		await git(['switch', '-c', 'change'])
		await write(DRIVER_FILE, BRANCHED_DRIVER.replace("'busy'", "'busy' // the fallback"))
		await link_node_modules()

		const report = await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)

		expect(report.unpinned).toEqual([])
		expect(report.unchecked).toEqual([])
	},
	RUN_TIMEOUT,
)
