import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { related_heavy_tests } from './related-heavy-tests'
import { test_declared_logic } from './test-declared-logic'
import { test_pinned_probe, type Probe } from './test-pinned-probe'
import { test_pinned_stage } from './test-pinned-stage'
import { unit_durations } from './unit-durations'

// joshuafolkken/kit#5122: a probe narrows by `josh test:related`'s rule — a file every test imports
// reaches the test files importing it directly, never the whole suite — and leaves out the heavy files
// a hunk reaches only indirectly.

const { EXCLUDE_FLAG, HEAVY_TEST_MS } = related_heavy_tests
const WORKERS = 2
const EVERY_TEST_MODULE = 'tools/test/unit-projects.ts'
const UNIMPORTED_MODULE = 'tools/test/pure-files.ts'
const HUB_MODULE = 'scripts/lib/hub.ts'
const ALIASED_IMPORTER = 'tools/test/unit-projects.test.ts'
const RELATIVE_IMPORTER = 'scripts/test/vitest-config.test.ts'
const HUB_TEST = 'scripts/lib/hub.test.ts'
const HEAVY_TEST = 'tools/test/harness.integration.test.ts'
const PACKAGE_FILE = 'package.json'

const FIXTURE_FILES: Readonly<Record<string, string>> = {
	[PACKAGE_FILE]: JSON.stringify({ imports: Object.fromEntries([['#tools/*', './tools/*.ts']]) }),
	[unit_durations.RECORD_FILE]: JSON.stringify(
		Object.fromEntries([[HEAVY_TEST, HEAVY_TEST_MS + 1]]),
	),
	[EVERY_TEST_MODULE]: 'export const projects = []\n',
	[UNIMPORTED_MODULE]: 'export const pure = []\n',
	[HUB_MODULE]: 'export const hub = 1\n',
	[ALIASED_IMPORTER]: "import { projects } from '#tools/test/unit-projects'\n",
	[RELATIVE_IMPORTER]: "import { projects } from '../../tools/test/unit-projects'\n",
	[HUB_TEST]: "import { hub } from './hub'\n",
	[HEAVY_TEST]: "import { harness } from './harness'\n",
}

function probe_of(file: string, reach?: number): Probe {
	return { hunk: { file, new_start: 1, new_count: 1, old_lines: [] }, index: 0, reach }
}

const held: { fixture?: FixtureWorkspace } = {}

async function open_fixture(): Promise<void> {
	const fixture = git_fixture_workspace.open_workspace('test-pinned-selection-')

	held.fixture = fixture
	await git_fixture_workspace.git(fixture.workspace, ['init', '--quiet'])

	for (const [file, content] of Object.entries(FIXTURE_FILES)) {
		mkdirSync(path.dirname(path.join(fixture.workspace, file)), { recursive: true })
		writeFileSync(path.join(fixture.workspace, file), content)
	}
}

async function close_fixture(): Promise<void> {
	if (held.fixture !== undefined) await git_fixture_workspace.close_workspace(held.fixture)
}

async function selection(file: string, reach?: number): Promise<Array<string> | undefined> {
	const root = held.fixture?.workspace ?? ''

	return await test_pinned_probe.selection_of(root, probe_of(file, reach), WORKERS)
}

describe('test_pinned_probe.selection_of', () => {
	beforeEach(open_fixture)
	afterEach(close_fixture)

	it('lists the test files importing a file every test imports, not the file itself', async () => {
		const argv = await selection(EVERY_TEST_MODULE)

		expect(argv?.slice(0, 3)).toEqual(['related', RELATIVE_IMPORTER, ALIASED_IMPORTER])
		expect(argv).not.toContain(EVERY_TEST_MODULE)
	})

	it('runs nothing for a file every test imports that no test imports directly', async () => {
		await expect(selection(UNIMPORTED_MODULE)).resolves.toBeUndefined()
	})

	it('leaves out the heavy test files the hunk reaches only indirectly', async () => {
		const argv = await selection(HUB_MODULE)

		expect(argv?.slice(0, 2)).toEqual(['related', HUB_MODULE])
		expect(argv).toEqual(expect.arrayContaining([EXCLUDE_FLAG, HEAVY_TEST]))
	})
})

// joshuafolkken/kit#5292: a wide reach runs the direct importers first.
describe('test_pinned_probe.selection_of — a counted reach', () => {
	beforeEach(open_fixture)
	afterEach(close_fixture)

	it('runs first the test files importing a file whose reach is wide', async () => {
		const argv = await selection(HUB_MODULE, test_pinned_stage.WIDE_REACH)

		expect(argv?.slice(0, 2)).toEqual(['related', HUB_TEST])
	})

	it('runs the whole reach of a file whose reach is narrow', async () => {
		const argv = await selection(HUB_MODULE, 1)

		expect(argv?.slice(0, 2)).toEqual(['related', HUB_MODULE])
	})
})

// `vitest related` runs the whole suite when handed a config dependency such as `unit-projects.ts`, so
// in this repository's own tree a probe hands it the direct importers' test files alone
// (joshuafolkken/kit#5260; 2081 test files in #5105, before #5122).
describe('test_pinned_probe.selection_of — in this repository', () => {
	it('hands vitest only test files for a file every test imports', async () => {
		const argv = await test_pinned_probe.selection_of(process.cwd(), probe_of(EVERY_TEST_MODULE), 1)
		const related = argv?.slice(1, argv.indexOf('--run')) ?? []

		expect(related.length).toBeGreaterThan(0)
		expect(related.filter((file) => !test_declared_logic.is_test_file(file))).toEqual([])
	})
})
