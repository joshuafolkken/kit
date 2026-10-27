import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { base_tree } from '#scripts/git/base-tree'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_fixture, type Template } from './test-pinned-fixture'
import { test_pinned_logic } from './test-pinned-logic'
import { test_red } from './test-red'
import { test_unit_guard } from './test-unit-guard'

// joshuafolkken/kit#4706: `josh test:pinned` (and `josh run:review`, which calls the same `run`) reuses
// a hunk's stored verdict — a pinned one while the code change and the test it failed in are the same
// (joshuafolkken/kit#4790), an unpinned one while no test file changed, either also while the edit leaves
// its import-graph basis alone (joshuafolkken/kit#4873) — and spreads the rest over as many trees as the
// worker budget allows, with the verdicts a serial run gives.

const RUN_TIMEOUT = 240_000
const CACHE_NAME = 'josh-test-pinned-verdicts.json'
const {
	DRIVER_FILE,
	CHANGED_DRIVER,
	build_change_branch,
	copy_template,
	git,
	open_template,
	write,
} = test_pinned_fixture
const EXTRA_TEST = 'extra.test.ts'
// A source file no hunk sits in and no test reaches, standing in for a fixture or a fix elsewhere.
const OUTSIDE_FILE = 'outside.ts'
const APPROVAL_FILE = path.join('.josh', 'metrics-accepted', '1.json')
const OBSERVATION_FILE = path.join('.josh', 'observations', '1.md')
const LEGACY_LEDGER_FILE = path.join('docs', 'maintainers', 'observations', '1.md')
const OBSERVATION_LINE = '- observed\n'
// joshuafolkken/kit#4723: the module the test reaches the driver through, and the same module once it
// stops importing the driver — a copy of its functions — so no test reaches the driver's hunks.
const APP_FILE = 'app.js'
const APP_THROUGH_DRIVER = `export { label, token_of } from './${DRIVER_FILE}'\n`
const APP_WITHOUT_DRIVER = `export function label(code) {
	return code === 0 ? 'merged' : 'busy'
}

export function token_of(result) {
	return result.token
}
`
const PINNED_HUNK = `${DRIVER_FILE}:3`
const UNPINNED_HUNK = `${DRIVER_FILE}:6`

// The change branch with its test reaching the driver only through `app.js`.
async function build_through_app(): Promise<void> {
	await build_change_branch()
	await write(APP_FILE, APP_THROUGH_DRIVER)
	await write(
		test_pinned_fixture.TEST_FILE,
		test_pinned_fixture.DEFAULT_PATH_TEST.replace(`./${DRIVER_FILE}`, './app.js'),
	)
}

function locations(report: Report): Array<string> {
	return report.unpinned.map((hunk) => test_pinned_logic.location(hunk))
}

// A test file that reaches none of the fixture's code.
function extra_test(title: string): string {
	return `import { it } from 'vitest'\n\nit('${title}', () => {})\n`
}

type Report = Awaited<ReturnType<typeof test_pinned.run>>

const fixture: { current?: FixtureWorkspace; template?: Template<Report> } = {}

async function run_report(): Promise<Report> {
	return await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)
}

beforeAll(async () => {
	fixture.template = await open_template(
		'test-pinned-cache-template-',
		build_change_branch,
		run_report,
	)
}, RUN_TIMEOUT)

afterAll(async () => {
	if (fixture.template !== undefined) {
		await git_fixture_workspace.close_workspace(fixture.template.workspace)
	}
})

beforeEach(() => {
	const workspace = git_fixture_workspace.open_workspace('test-pinned-cache-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
})

afterEach(async () => {
	vi.restoreAllMocks()
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

// The change branch after its first run, and that run's report.
async function after_first_run(): Promise<Report> {
	if (fixture.template === undefined) throw new Error('the template was not built')

	return await copy_template(fixture.template)
}

async function drop_cache(): Promise<void> {
	await rm(await git(['rev-parse', '--git-path', CACHE_NAME]), { force: true })
}

describe('test_pinned.run with a stored verdict', () => {
	it(
		'answers the same report on a second run over the same tree without starting vitest',
		async () => {
			const first = await after_first_run()
			const runs = vi.spyOn(test_red, 'probe_in')

			const second = await run_report()

			expect(runs).not.toHaveBeenCalled()
			expect(second).toEqual(first)
		},
		RUN_TIMEOUT,
	)

	it(
		'checks the pinned hunk again but keeps the unpinned one after a file outside the hunks changed',
		async () => {
			const first = await after_first_run()

			await write(OUTSIDE_FILE, 'export const outside = 1\n')
			const runs = vi.spyOn(test_red, 'probe_in')

			const report = await run_report()

			expect(runs).toHaveBeenCalledTimes(1)
			expect(report).toEqual(first)
		},
		RUN_TIMEOUT,
	)
})

// joshuafolkken/kit#4856: a run writes its own records after a probe, and no test reads them.
describe('test_pinned.run after only run records changed', () => {
	it(
		'keeps every verdict without starting vitest when an approval and an observation are written',
		async () => {
			const first = await after_first_run()

			await mkdir(path.dirname(APPROVAL_FILE), { recursive: true })
			await mkdir(path.dirname(OBSERVATION_FILE), { recursive: true })
			await write(APPROVAL_FILE, '{}\n')
			await write(OBSERVATION_FILE, OBSERVATION_LINE)
			const runs = vi.spyOn(test_red, 'probe_in')

			const report = await run_report()

			expect(runs).not.toHaveBeenCalled()
			expect(report).toEqual(first)
		},
		RUN_TIMEOUT,
	)

	it(
		'checks the pinned hunk again after a legacy ledger file under docs/ changed, which a test may read',
		async () => {
			await after_first_run()

			await mkdir(path.dirname(LEGACY_LEDGER_FILE), { recursive: true })
			await write(LEGACY_LEDGER_FILE, OBSERVATION_LINE)
			const runs = vi.spyOn(test_red, 'probe_in')

			await run_report()

			expect(runs).toHaveBeenCalledTimes(1)
		},
		RUN_TIMEOUT,
	)
})

describe('test_pinned.run after a hunk changed', () => {
	it(
		'checks every hunk again, since the pinned one sits in the changed tree',
		async () => {
			await after_first_run()
			await write(DRIVER_FILE, CHANGED_DRIVER.replace("'--driver'", "'--drive'"))
			const runs = vi.spyOn(test_red, 'probe_in')

			const report = await run_report()

			expect(runs).toHaveBeenCalledTimes(2)
			expect(report.unpinned.map((hunk) => test_pinned_logic.location(hunk))).toEqual([
				`${DRIVER_FILE}:6`,
			])
		},
		RUN_TIMEOUT,
	)
})

// joshuafolkken/kit#5004: the usual fix for an unpinned hunk is removing its lines, which changes the
// code change and the pinned hunk's failed-test closure both.
describe('test_pinned.run after lines of the unpinned hunk were removed', () => {
	it(
		'keeps the pinned verdict without starting vitest once the unpinned hunk is removed whole',
		async () => {
			const first = await after_first_run()
			const [unpinned] = first.unpinned

			expect(unpinned).toBeDefined()
			if (unpinned === undefined) return
			await write(DRIVER_FILE, test_pinned_logic.revert(CHANGED_DRIVER, unpinned))
			const runs = vi.spyOn(test_red, 'probe_in')

			const report = await run_report()

			expect(runs).not.toHaveBeenCalled()
			expect(report.unpinned).toEqual([])
		},
		RUN_TIMEOUT,
	)

	it(
		'probes only what is left of the unpinned hunk once one of its lines is removed',
		async () => {
			await after_first_run()
			await write(DRIVER_FILE, CHANGED_DRIVER.replace(/^\treturn argv.*\n/mu, ''))
			const runs = vi.spyOn(test_red, 'probe_in')

			await run_report()

			expect(runs).toHaveBeenCalledTimes(1)
		},
		RUN_TIMEOUT,
	)
})

describe('test_pinned.run after a source between the test and the hunk changed', () => {
	it(
		'reuses the pinned verdict while nothing changed, then reports the hunk unpinned once no test reaches it',
		async () => {
			await build_through_app()
			const first = await run_report()

			expect(locations(first)).toEqual([UNPINNED_HUNK])

			const runs = vi.spyOn(test_red, 'probe_in')

			expect(await run_report()).toEqual(first)
			expect(runs).not.toHaveBeenCalled()

			await write(APP_FILE, APP_WITHOUT_DRIVER)
			const report = await run_report()

			expect(locations(report)).toEqual(expect.arrayContaining([PINNED_HUNK, UNPINNED_HUNK]))
		},
		RUN_TIMEOUT,
	)
})

describe('test_pinned.run after a test file is added', () => {
	it(
		'checks the unpinned hunk again but keeps the pinned one, whose failed test is unchanged',
		async () => {
			const first = await after_first_run()

			await write(EXTRA_TEST, extra_test('runs'))
			const runs = vi.spyOn(test_red, 'probe_in')

			const report = await run_report()

			expect(runs).toHaveBeenCalledTimes(1)
			expect(report).toEqual(first)
		},
		RUN_TIMEOUT,
	)
})

// joshuafolkken/kit#4790: a pinned hunk rests on the test file it failed in.
describe('test_pinned.run after the test a pinned hunk failed in changed', () => {
	it(
		'checks every hunk again',
		async () => {
			await after_first_run()
			await write(
				test_pinned_fixture.TEST_FILE,
				`${test_pinned_fixture.DEFAULT_PATH_TEST}\nit('runs', () => {})\n`,
			)
			const runs = vi.spyOn(test_red, 'probe_in')

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

describe('test_pinned.run after an existing test file changed', () => {
	it(
		'checks the unpinned hunk again, which any test may have come to reach, but keeps the pinned one',
		async () => {
			await build_change_branch()
			await write(EXTRA_TEST, extra_test('runs'))
			const first = await run_report()

			await write(EXTRA_TEST, extra_test('runs again'))
			const runs = vi.spyOn(test_red, 'probe_in')

			await run_report()

			expect(first.unpinned).toHaveLength(1)
			expect(runs).toHaveBeenCalledTimes(1)
		},
		RUN_TIMEOUT,
	)
})
