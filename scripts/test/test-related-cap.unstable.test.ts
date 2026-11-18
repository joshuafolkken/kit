import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_logic } from './test-pinned-logic'
import type { ReachedCount } from './test-pinned-reach'
import { test_related_cap, type CountReader } from './test-related-cap'

// joshuafolkken/kit#7924: a hub past the cap whose imports moved — a new file, or one that changed its
// imports — ran its whole reach (1,340 test files for a 25-file change). It runs its direct importers
// and the tests of its reach that mock a module, which a new import can break (#7453).
vi.mock('./test-related-imports', () => ({
	test_related_imports: { stable_files: async () => [] },
}))

const { MAX_TEST_FILES } = test_pinned_logic
const HUB = 'scripts/hub.ts'
const DIRECT_TEST = 'scripts/hub.test.ts'
const MOCK_TEST = 'scripts/mock.test.ts'
const PLAIN_TESTS = Array.from(
	{ length: MAX_TEST_FILES },
	(_, index) => `scripts/p${String(index)}.test.ts`,
)
const REACH = [DIRECT_TEST, MOCK_TEST, ...PLAIN_TESTS]
const FIXTURE_FILES: Readonly<Record<string, string>> = {
	'package.json': JSON.stringify({ imports: {} }),
	[HUB]: "import { readFileSync } from 'node:fs'\nexport const hub = readFileSync\n",
	[DIRECT_TEST]: "import { hub } from './hub'\n",
	[MOCK_TEST]: "vi.mock('node:fs', () => ({}))\nawait import('./entry')\n",
	...Object.fromEntries(PLAIN_TESTS.map((test) => [test, "import './entry'\n"])),
}

function write_fixture(root: string): void {
	for (const [file, content] of Object.entries(FIXTURE_FILES)) {
		mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
		writeFileSync(path.join(root, file), content)
	}
}

function reader_of(tests: ReadonlyArray<string> | undefined): CountReader {
	return async (files: ReadonlyArray<string>): Promise<Array<ReachedCount>> =>
		files.map((file) => ({ file, count: REACH.length, tests }))
}

describe('test_related_cap.capped_importers for a hub whose imports moved', () => {
	let fixture: FixtureWorkspace

	beforeEach(async () => {
		fixture = git_fixture_workspace.open_workspace('test-related-cap-unstable-')
		await git_fixture_workspace.git(fixture.workspace, ['init', '--quiet'])
		write_fixture(fixture.workspace)
	})

	afterEach(async () => {
		await git_fixture_workspace.close_workspace(fixture)
	})

	it('runs its direct importers and the tests of its reach that mock a module', async () => {
		const reader = reader_of(REACH)
		const capped = await test_related_cap.capped_importers(fixture.workspace, [HUB], false, reader)

		expect(capped.over_cap).toEqual([HUB])
		expect(capped.importers.get(HUB)).toEqual([DIRECT_TEST, MOCK_TEST])
		expect(capped.full_reach).toEqual([])
	})

	it('records counts alone, not the test lists the graph read', async () => {
		const reader = reader_of(REACH)
		const capped = await test_related_cap.capped_importers(fixture.workspace, [HUB], false, reader)

		expect(capped.reach).toEqual([{ file: HUB, count: 2 }])
	})

	it('keeps its whole reach where the graph listed no tests for it', async () => {
		const reader = reader_of(undefined)
		const capped = await test_related_cap.capped_importers(fixture.workspace, [HUB], false, reader)

		expect(capped.over_cap).toEqual([])
		expect(capped.full_reach).toEqual([{ file: HUB, count: REACH.length }])
	})
})
