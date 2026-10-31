import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_logic } from './test-pinned-logic'
import type { ReachedCount } from './test-pinned-reach'
import { test_related_cap, type CappedImporters, type CountReader } from './test-related-cap'
import { related_scope, type RelatedScope } from './test-related-scope'

// joshuafolkken/kit#5532: a changed file whose imports reach more test files than the cap runs only the
// tests importing it directly, and the run's summary names it.

const { MAX_TEST_FILES } = test_pinned_logic
const PACKAGE_FILE = 'package.json'
const WIDE_MODULE = 'scripts/wide.ts'
const DIRECT_TEST = 'scripts/wide.test.ts'
const MIDDLE_MODULE = 'scripts/middle.ts'
const MIDDLE_TEST = 'scripts/middle.test.ts'
const GONE_MODULE = 'scripts/gone.ts'
const LONE_MODULE = 'scripts/lone.ts'
const FIXTURE_FILES: Readonly<Record<string, string>> = {
	[PACKAGE_FILE]: JSON.stringify({ imports: {} }),
	[WIDE_MODULE]: 'export const wide = 1\n',
	[LONE_MODULE]: 'export const lone = 1\n',
	[MIDDLE_MODULE]: "export { wide } from './wide'\n",
	[DIRECT_TEST]: "import { wide } from './wide'\n",
	[MIDDLE_TEST]: "import { wide } from './middle'\n",
}

async function open_fixture(): Promise<FixtureWorkspace> {
	const fixture = git_fixture_workspace.open_workspace('test-related-cap-')

	await git_fixture_workspace.git(fixture.workspace, ['init', '--quiet'])

	for (const [file, content] of Object.entries(FIXTURE_FILES)) {
		mkdirSync(path.dirname(path.join(fixture.workspace, file)), { recursive: true })
		writeFileSync(path.join(fixture.workspace, file), content)
	}

	return fixture
}

function reader_of(count: number): CountReader {
	return vi.fn(async (files: ReadonlyArray<string>): Promise<Array<ReachedCount>> =>
		files.map((file) => ({ file, count })),
	)
}

function scope_of(root: string, capped: CappedImporters): RelatedScope {
	return related_scope.resolve_scope({
		root,
		changed: [WIDE_MODULE],
		map: undefined,
		recorded: new Set(),
		is_present: () => true,
		every_test_importers: capped.importers,
	})
}

describe('test_related_cap.capped_importers at and past the cap', () => {
	let fixture: FixtureWorkspace

	beforeEach(async () => {
		fixture = await open_fixture()
	})

	afterEach(async () => {
		await git_fixture_workspace.close_workspace(fixture)
	})

	it('runs only the direct importers of a file past the cap and prints 1 over cap', async () => {
		const { workspace } = fixture
		const capped = await test_related_cap.capped_importers(
			workspace,
			[WIDE_MODULE],
			false,
			reader_of(MAX_TEST_FILES + 1),
		)

		expect(capped.over_cap).toEqual([WIDE_MODULE])
		expect(scope_of(workspace, capped).files).toEqual([path.join(workspace, DIRECT_TEST)])
		expect(test_related_cap.over_cap_line(capped.over_cap)).toContain('1 over cap')
	})

	it('leaves a file at the cap to vitest, as before', async () => {
		const { workspace } = fixture
		const capped = await test_related_cap.capped_importers(
			workspace,
			[WIDE_MODULE],
			false,
			reader_of(MAX_TEST_FILES),
		)

		expect(capped.over_cap).toEqual([])
		expect(scope_of(workspace, capped).files).toEqual([path.join(workspace, WIDE_MODULE)])
		expect(test_related_cap.over_cap_line(capped.over_cap)).toBeUndefined()
	})
})

describe('test_related_cap.capped_importers reading no reach', () => {
	let fixture: FixtureWorkspace

	beforeEach(async () => {
		fixture = await open_fixture()
	})

	afterEach(async () => {
		await git_fixture_workspace.close_workspace(fixture)
	})

	it('applies no cap and builds no graph under --keep-whole-suite', async () => {
		const reader = reader_of(MAX_TEST_FILES + 1)
		const capped = await test_related_cap.capped_importers(
			fixture.workspace,
			[WIDE_MODULE],
			true,
			reader,
		)

		expect(capped).toEqual(test_related_cap.NO_CAP)
		expect(reader).not.toHaveBeenCalled()
	})

	it('reads no reach for a changed test or a file no longer in the tree', async () => {
		const reader = reader_of(MAX_TEST_FILES + 1)
		const files = [DIRECT_TEST, GONE_MODULE]
		const capped = await test_related_cap.capped_importers(fixture.workspace, files, false, reader)

		expect(capped.over_cap).toEqual([])
		expect(reader).not.toHaveBeenCalled()
	})
})

describe('test_related_cap.capped_importers with no direct importer', () => {
	let fixture: FixtureWorkspace

	beforeEach(async () => {
		fixture = await open_fixture()
	})

	afterEach(async () => {
		await git_fixture_workspace.close_workspace(fixture)
	})

	it('leaves a file past the cap that no test imports directly to vitest', async () => {
		const reader = reader_of(MAX_TEST_FILES + 1)
		const capped = await test_related_cap.capped_importers(
			fixture.workspace,
			[LONE_MODULE],
			false,
			reader,
		)

		expect(capped).toEqual(test_related_cap.NO_CAP)
		expect(reader).toHaveBeenCalledOnce()
	})
})

describe('test_related_cap.capped_importers with no graph', () => {
	let fixture: FixtureWorkspace

	beforeEach(async () => {
		fixture = await open_fixture()
	})

	afterEach(async () => {
		await git_fixture_workspace.close_workspace(fixture)
	})

	it('caps nothing', async () => {
		const reader = vi.fn(async (): Promise<undefined> => {
			await Promise.resolve(undefined)
		})
		const capped = await test_related_cap.capped_importers(
			fixture.workspace,
			[WIDE_MODULE],
			false,
			reader,
		)

		expect(capped.over_cap).toEqual([])
	})
})

describe('test_related_cap.over_cap_of', () => {
	it('keeps the files reaching more test files than the cap', () => {
		const counts = [
			{ file: WIDE_MODULE, count: MAX_TEST_FILES + 1 },
			{ file: MIDDLE_MODULE, count: MAX_TEST_FILES },
		]

		expect(test_related_cap.over_cap_of(counts)).toEqual([WIDE_MODULE])
	})
})
