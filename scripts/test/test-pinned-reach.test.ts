import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_pinned_logic } from './test-pinned-logic'
import { test_pinned_reach, type ReachInputs } from './test-pinned-reach'
import { test_red } from './test-red'

// joshuafolkken/kit#4873: past the tree-wide digests, a `josh test:pinned` verdict holds while what it
// rests on is the same — the tests reaching the hunk's file for an unpinned one, the failed test's
// import closure and the changed non-code files for a pinned one.

const RUN_TIMEOUT = 240_000
const { DRIVER_FILE, TEST_FILE, build_change_branch, write } = test_pinned_fixture
const TSCONFIG = 'tsconfig.json'
const TSCONFIG_CONTENT =
	'{ "compilerOptions": { "allowJs": true, "moduleResolution": "bundler", "module": "esnext" } }\n'
const EXTRA_TEST = 'extra.test.ts'
const OUTSIDE_FILE = 'outside.ts'
// A test importing `outside.ts` and reaching no hunk, so the graph ties it to a test no hunk rests on.
const USER_FILE = 'user.test.ts'
const USER_CONTENT = "import './outside'\nimport { it } from 'vitest'\n\nit('runs', () => {})\n"
// A code file nothing imports, as a CLI a test spawns: the graph cannot tie it to any test.
const ROOT_FILE = 'cli.ts'
const ROOT_IMPORTING_OUTSIDE = "export { outside } from './outside'\n"
const FIXTURE_FILE = 'fixture.json'
const UNPINNED_HUNK = `${DRIVER_FILE}:6`
// The module the test reaches the driver through.
const APP_FILE = 'app.js'
const APP_THROUGH_DRIVER = `export { label, token_of } from './${DRIVER_FILE}'\n`

const fixture: { current?: FixtureWorkspace } = {}

beforeEach(() => {
	const workspace = git_fixture_workspace.open_workspace('test-pinned-reach-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
})

afterEach(async () => {
	vi.restoreAllMocks()
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

// The change branch with a `tsconfig.json`, so an import graph can be built over it.
async function build_with_graph(): Promise<void> {
	await build_change_branch()
	await write(TSCONFIG, TSCONFIG_CONTENT)
}

async function write_outside(value: number): Promise<void> {
	await write(OUTSIDE_FILE, `export const outside = ${String(value)}\n`)
}

// The graph branch with `outside.ts` imported by `importer` alone.
async function build_with_outside(importer = USER_FILE, content = USER_CONTENT): Promise<void> {
	await build_with_graph()
	await write(importer, content)
	await write_outside(0)
}

// The graph branch with the test reaching the driver through `app.js`.
async function build_with_app(): Promise<void> {
	await build_with_graph()
	await write(APP_FILE, APP_THROUGH_DRIVER)
	await write(
		TEST_FILE,
		test_pinned_fixture.DEFAULT_PATH_TEST.replace(`./${DRIVER_FILE}`, './app.js'),
	)
}

function extra_test(title: string): string {
	return `import { it } from 'vitest'\n\nit('${title}', () => {})\n`
}

async function run_report(): ReturnType<typeof test_pinned.run> {
	return await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)
}

function locations(report: Awaited<ReturnType<typeof test_pinned.run>>): Array<string> {
	return report.unpinned.map((hunk) => test_pinned_logic.location(hunk))
}

function inputs_of(digests: ReadonlyArray<readonly [string, string]>): ReachInputs {
	return { commit: 'base', code: [DRIVER_FILE], digests: new Map(), test_digests: new Map(digests) }
}

async function related_with(digests: ReadonlyArray<readonly [string, string]>): Promise<unknown> {
	return await test_pinned_reach.create(inputs_of(digests)).related(DRIVER_FILE)
}

describe('test_pinned.run over an import graph after an edit no hunk rests on', () => {
	it(
		'keeps every verdict without starting vitest after a test reaching no hunk is added',
		async () => {
			await build_with_graph()
			const first = await run_report()

			await write(EXTRA_TEST, extra_test('runs'))
			const runs = vi.spyOn(test_red, 'probe_in')

			expect(await run_report()).toEqual(first)
			expect(runs).not.toHaveBeenCalled()
		},
		RUN_TIMEOUT,
	)

	it(
		'keeps the pinned verdict without starting vitest after a source only another test imports changed',
		async () => {
			await build_with_outside()
			const first = await run_report()

			await write_outside(1)
			const runs = vi.spyOn(test_red, 'probe_in')

			expect(await run_report()).toEqual(first)
			expect(runs).not.toHaveBeenCalled()
		},
		RUN_TIMEOUT,
	)
})

// The round-1 fix of joshuafolkken/kit#4868: a test and a source edited together.
describe('test_pinned.run over an import graph after a test and a source both changed', () => {
	it(
		'keeps every verdict after an edit to a test reaching no hunk and a source only it imports',
		async () => {
			await build_with_outside()
			await write(EXTRA_TEST, extra_test('runs'))
			await run_report()
			await write(EXTRA_TEST, extra_test('runs again'))
			await write_outside(2)
			const runs = vi.spyOn(test_red, 'probe_in')

			expect(locations(await run_report())).toEqual([UNPINNED_HUNK])
			expect(runs).not.toHaveBeenCalled()
		},
		RUN_TIMEOUT,
	)
})

describe('test_pinned.run over an import graph after an edit a hunk rests on', () => {
	it(
		'checks every hunk again after the test reaching them changed',
		async () => {
			await build_with_graph()
			await run_report()
			await write(TEST_FILE, `${test_pinned_fixture.DEFAULT_PATH_TEST}\nit('runs', () => {})\n`)
			const runs = vi.spyOn(test_red, 'probe_in')

			await run_report()

			expect(runs).toHaveBeenCalledTimes(2)
		},
		RUN_TIMEOUT,
	)

	it(
		'checks the pinned hunk again after a non-code file changed, which a test may read',
		async () => {
			await build_with_graph()
			await run_report()
			await write(FIXTURE_FILE, '{}\n')
			const runs = vi.spyOn(test_red, 'probe_in')

			await run_report()

			expect(runs).toHaveBeenCalledTimes(1)
		},
		RUN_TIMEOUT,
	)
})

describe('test_pinned.run over an import graph after an edit the failed test rests on', () => {
	it(
		"checks the pinned hunk again after a module in the failed test's import closure changed",
		async () => {
			await build_with_app()
			await run_report()
			await write(APP_FILE, `${APP_THROUGH_DRIVER}// edited\n`)
			const runs = vi.spyOn(test_red, 'probe_in')

			await run_report()

			expect(runs).toHaveBeenCalledTimes(1)
		},
		RUN_TIMEOUT,
	)

	it(
		'checks the pinned hunk again after a code file nothing imports changed',
		async () => {
			await build_with_graph()
			await run_report()
			await write(ROOT_FILE, 'export const cli = 1\n')
			const runs = vi.spyOn(test_red, 'probe_in')

			await run_report()

			expect(runs).toHaveBeenCalledTimes(1)
		},
		RUN_TIMEOUT,
	)
})

// The round-2 fix: a module a spawned CLI imports runs past every test's import closure.
describe('test_pinned.run over an import graph after an edit a spawned CLI rests on', () => {
	it(
		'checks the pinned hunk again after a module only a code file nothing imports reaches changed',
		async () => {
			await build_with_outside(ROOT_FILE, ROOT_IMPORTING_OUTSIDE)
			await run_report()
			await write_outside(1)
			const runs = vi.spyOn(test_red, 'probe_in')

			await run_report()

			expect(runs).toHaveBeenCalledTimes(1)
		},
		RUN_TIMEOUT,
	)
})

describe('test_pinned.run over an import graph after an edit made while it ran', () => {
	it(
		'reads no basis off the edit, so the next run checks the pinned hunk again',
		async () => {
			await build_with_app()
			const probe_in = test_red.probe_in.bind(test_red)

			vi.spyOn(test_red, 'probe_in').mockImplementationOnce(async (...parameters) => {
				await write(APP_FILE, `${APP_THROUGH_DRIVER}// edited\n`)

				return await probe_in(...parameters)
			})
			await run_report()
			vi.restoreAllMocks()
			const runs = vi.spyOn(test_red, 'probe_in')

			await run_report()

			expect(runs).toHaveBeenCalledTimes(1)
		},
		RUN_TIMEOUT,
	)
})

describe('test_pinned_reach.create', () => {
	it('reads no basis where no tsconfig.json is there to build a graph from', async () => {
		await build_change_branch()
		const reach = test_pinned_reach.create(inputs_of([[TEST_FILE, 'a']]))

		expect(await reach.related(DRIVER_FILE)).toBeUndefined()
		expect(await reach.failed([TEST_FILE])).toBeUndefined()
	})

	it('reads the reaching tests only as the related basis', async () => {
		await build_with_graph()

		expect(await related_with([[TEST_FILE, 'a']])).toEqual([TEST_FILE])
		expect(
			await related_with([
				[TEST_FILE, 'a'],
				[EXTRA_TEST, 'b'],
			]),
		).toEqual([TEST_FILE])
	})

	it('reads no red basis for a failed test the tree no longer digests, or none named', async () => {
		await build_with_graph()
		const reach = test_pinned_reach.create(inputs_of([[TEST_FILE, 'a']]))

		expect(await reach.failed([EXTRA_TEST])).toBeUndefined()
		expect(await reach.failed([])).toBeUndefined()
		expect(await reach.failed([TEST_FILE])).toEqual(expect.any(String))
	})
})
