import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_pinned_fixture_probe } from './test-pinned-fixture-probe'
import { test_red } from './test-red'

// joshuafolkken/kit#9117: the in-process probe the `test-pinned-*` tests use must read each fixture
// revert as the real vitest probe does.

const RUN_TIMEOUT = 240_000
const { CHANGED_DRIVER, DRIVER_FILE, TEST_FILE, build_change_branch, write } = test_pinned_fixture
const PINNED_REVERTED = CHANGED_DRIVER.replace("'merged'", "'ok'")
const UNPINNED_REVERTED = CHANGED_DRIVER.replace(
	"[result.token, String(result.code)][Number(argv.includes('--driver'))]",
	'result.token',
)
const RELATED_DRIVER = ['related', DRIVER_FILE, '--run']

const fixture: { current?: FixtureWorkspace } = {}

beforeAll(async () => {
	const workspace = git_fixture_workspace.open_workspace('test-pinned-fixture-probe-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
	await build_change_branch()
}, RUN_TIMEOUT)

afterAll(async () => {
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

async function both(driver: string, selection: ReadonlyArray<string>): Promise<Array<unknown>> {
	await write(DRIVER_FILE, driver)
	const tree = process.cwd()
	const base = { parent: path.dirname(tree), tree }

	const in_process = await test_pinned_fixture_probe.probe_in(base, selection)

	return [in_process, await test_red.probe_in(base, selection)]
}

describe('test_pinned_fixture_probe.probe_in', () => {
	it(
		'reads a reverted pinned hunk red, as the vitest probe does',
		async () => {
			const [in_process, real] = await both(PINNED_REVERTED, RELATED_DRIVER)

			expect(in_process).toEqual(real)
			expect(in_process).toEqual({ verdict: 'red', failed: [TEST_FILE], ran: 1 })
		},
		RUN_TIMEOUT,
	)

	it(
		'reads a reverted unpinned hunk green, as the vitest probe does',
		async () => {
			const [in_process, real] = await both(UNPINNED_REVERTED, ['run', TEST_FILE])

			expect(in_process).toEqual(real)
			expect(in_process).toEqual({ verdict: 'green', failed: [], ran: 1 })
		},
		RUN_TIMEOUT,
	)

	it(
		'reads a file no test reaches as the vitest probe does',
		async () => {
			const [in_process, real] = await both(CHANGED_DRIVER, ['related', 'added.js', '--run'])

			expect(in_process).toEqual(real)
			expect(in_process).toEqual({ verdict: 'no-test', failed: [], ran: 0 })
		},
		RUN_TIMEOUT,
	)
})

describe('test_pinned_fixture_probe.probe_in — an excluded test', () => {
	it(
		'leaves an excluded test out of a related run, as the vitest probe does',
		async () => {
			const selection = [...RELATED_DRIVER, '--exclude', TEST_FILE]
			const [in_process, real] = await both(PINNED_REVERTED, selection)

			expect(in_process).toEqual(real)
			expect(in_process).toEqual({ verdict: 'no-test', failed: [], ran: 0 })
		},
		RUN_TIMEOUT,
	)
})
