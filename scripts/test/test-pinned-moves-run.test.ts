import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_fixture } from './test-pinned-fixture'

const RUN_TIMEOUT = 120_000
const { DRIVER_FILE, TEST_FILE, build_base, git, link_node_modules, snapshot, write } =
	test_pinned_fixture
const BASE = `export function environment(env, role) {
	return {
		...role,
		...env,
	}
}
`
const CHANGED = BASE.replace('...role,\n\t\t...env,', '...env,\n\t\t...role,')
const TEST = `import { expect, it } from 'vitest'
import { environment } from './driver.js'
it('the launcher role overrides the inherited role', () => {
	expect(environment({ role: 'worker' }, { role: 'launcher' }).role).toBe('launcher')
})
`
const UNPINNED_TEST = TEST.replace("{ role: 'worker' }", '{}')
const fixture: { current?: FixtureWorkspace } = {}

beforeEach(async () => {
	fixture.current = git_fixture_workspace.open_workspace('test-pinned-moves-')
	process.chdir(fixture.current.workspace)
	await build_base()
	await write(DRIVER_FILE, BASE)
	await git(['add', DRIVER_FILE])
	await git(['commit', '-m', 'base spread priority'])
	await git(['switch', '-c', 'change'])
	await write(DRIVER_FILE, CHANGED)
	await link_node_modules()
})

afterEach(async () => {
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

describe('test_pinned.run on a moved spread', () => {
	it.each([
		{ title: 'pins the priority regression', test: TEST, unpinned: 0 },
		{ title: 'rejects a test missing the priority regression', test: UNPINNED_TEST, unpinned: 1 },
	])(
		'$title',
		async ({ test, unpinned }) => {
			await write(TEST_FILE, test)
			const before = await snapshot()

			const report = await test_pinned.run(1)

			expect(report.unpinned).toHaveLength(unpinned)
			expect(report.unchecked).toEqual([])
			expect(report.stopped).toEqual([])
			expect(await snapshot()).toBe(before)
			const cached = await test_pinned.run(1)

			expect(cached.unpinned).toHaveLength(unpinned)
		},
		RUN_TIMEOUT,
	)

	it(
		'keeps the whole move unchecked when no probe fits the cap',
		async () => {
			await write(TEST_FILE, TEST)

			const report = await test_pinned.run(0)

			expect(report.unpinned).toEqual([])
			expect(report.unchecked).toHaveLength(1)
			expect(report.unchecked[0]?.parts).toHaveLength(2)
		},
		RUN_TIMEOUT,
	)
})
