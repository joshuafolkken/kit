import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { test_pinned } from './test-pinned'
import { test_pinned_fixture } from './test-pinned-fixture'
import { test_pinned_logic } from './test-pinned-logic'
import { test_pinned_reach } from './test-pinned-reach'

// joshuafolkken/kit#4879: a `-fixture` module only tests reach changes what they cover, never what runs,
// so `josh test:pinned` probes none of its hunks; one a root reaches is probed as before.

const RUN_TIMEOUT = 240_000
const { DRIVER_FILE, build_change_branch, write } = test_pinned_fixture
const TSCONFIG_CONTENT =
	'{ "compilerOptions": { "allowJs": true, "moduleResolution": "bundler", "module": "esnext" } }\n'
const FIXTURE_FILE = 'data-fixture.js'
// A function no test calls, so a probe stubbing it stays green and reports it unpinned.
const FIXTURE_CONTENT = 'export function data() {\n\treturn 1\n}\n'
const FIXTURE_TEST = 'data.test.ts'
const FIXTURE_TEST_CONTENT = `import { expect, it } from 'vitest'
import { data } from './${FIXTURE_FILE}'

it('imports the data', () => {
	expect(typeof data).toBe('function')
})
`
// A code file nothing imports, as a CLI: it makes the fixture runtime code.
const ROOT_FILE = 'cli.js'
const ROOT_CONTENT = `export { data } from './${FIXTURE_FILE}'\n`
const UNPINNED_HUNK = `${DRIVER_FILE}:6`
const FIXTURE_PROBE = `${FIXTURE_FILE}:1 data`

const fixture: { current?: FixtureWorkspace } = {}

beforeEach(() => {
	const workspace = git_fixture_workspace.open_workspace('test-pinned-probed-')

	fixture.current = workspace
	process.chdir(workspace.workspace)
})

afterEach(async () => {
	if (fixture.current !== undefined) await git_fixture_workspace.close_workspace(fixture.current)
})

// The change branch with a fixture its own test imports, and a `tsconfig.json` when `has_graph`.
async function build_with_fixture(has_graph = true): Promise<void> {
	await build_change_branch()
	if (has_graph) await write('tsconfig.json', TSCONFIG_CONTENT)
	await write(FIXTURE_FILE, FIXTURE_CONTENT)
	await write(FIXTURE_TEST, FIXTURE_TEST_CONTENT)
}

async function locations(): Promise<Array<string>> {
	const report = await test_pinned.run(test_pinned_logic.DEFAULT_MAX_HUNKS)

	return report.unpinned.map((hunk) => test_pinned_logic.location(hunk))
}

describe('test_pinned_reach.probed_files', () => {
	it('drops a fixture only tests import and keeps every other file', async () => {
		await build_with_fixture()

		expect(await test_pinned_reach.probed_files([DRIVER_FILE, FIXTURE_FILE])).toEqual([DRIVER_FILE])
	})

	it('keeps a fixture a code file nothing imports reaches', async () => {
		await build_with_fixture()
		await write(ROOT_FILE, ROOT_CONTENT)

		expect(await test_pinned_reach.probed_files([FIXTURE_FILE])).toEqual([FIXTURE_FILE])
	})

	it('keeps a fixture where no tsconfig.json is there to build a graph from', async () => {
		await build_with_fixture(false)

		expect(await test_pinned_reach.probed_files([FIXTURE_FILE])).toEqual([FIXTURE_FILE])
	})
})

// joshuafolkken/kit#5135: `josh test:related` sizes its claim by the tests its scope reaches.
describe('test_pinned_reach.reached_test_count', () => {
	it('counts the test a module reaches and a listed test once', async () => {
		await build_with_fixture()
		await write(ROOT_FILE, ROOT_CONTENT)

		expect(await test_pinned_reach.reached_test_count([FIXTURE_FILE, FIXTURE_TEST])).toBe(1)
	})

	it('counts nothing for an empty scope', async () => {
		await build_with_fixture()

		expect(await test_pinned_reach.reached_test_count([])).toBe(0)
	})

	it('answers nothing where no tsconfig.json is there to build a graph from', async () => {
		await build_with_fixture(false)

		expect(await test_pinned_reach.reached_test_count([FIXTURE_FILE])).toBeUndefined()
	})
})

describe('test_pinned.run on a changed fixture', () => {
	it(
		'reports no hunk of a fixture only tests import',
		async () => {
			await build_with_fixture()

			expect(await locations()).toEqual([UNPINNED_HUNK])
		},
		RUN_TIMEOUT,
	)

	it(
		'reports the unpinned hunk of a fixture a root reaches',
		async () => {
			await build_with_fixture()
			await write(ROOT_FILE, ROOT_CONTENT)

			expect(await locations()).toContain(FIXTURE_PROBE)
		},
		RUN_TIMEOUT,
	)
})
