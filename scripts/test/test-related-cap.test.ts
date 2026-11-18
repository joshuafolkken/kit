import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_fixture_workspace, type FixtureWorkspace } from '#scripts/git/git-fixture-workspace'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_logic } from './test-pinned-logic'
import type { ReachedCount } from './test-pinned-reach'
import { test_related_cap, type CountReader } from './test-related-cap'
import type { Selection } from './test-related-select'

// joshuafolkken/kit#7976: a run never hands vitest more than the cap; the rest is deferred to CI, and
// the summary line counts it and names the hub.

const { MAX_TEST_FILES } = test_pinned_logic
const PACKAGE_FILE = 'package.json'
const WIDE_MODULE = 'scripts/wide.ts'
const DIRECT_TEST = 'scripts/wide.test.ts'
const MIDDLE_MODULE = 'scripts/middle.ts'
const GONE_MODULE = 'scripts/gone.ts'
const LONE_MODULE = 'scripts/lone.ts'
const MERGED_HUB = 'scripts/merged-hub.ts'
const DEFERRED = 7
const FIXTURE_FILES: Readonly<Record<string, string>> = {
	[PACKAGE_FILE]: JSON.stringify({ imports: {} }),
	[WIDE_MODULE]: 'export const wide = 1\n',
	[LONE_MODULE]: 'export const lone = 1\n',
	[MIDDLE_MODULE]: "export { wide } from './wide'\n",
	[DIRECT_TEST]: "import { wide } from './wide'\n",
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

function selection_of(deferred: number): Selection {
	return {
		tests: [DIRECT_TEST],
		deferred,
		reach: [
			{ file: MERGED_HUB, count: MAX_TEST_FILES + 2 },
			{ file: MIDDLE_MODULE, count: 1 },
			{ file: WIDE_MODULE, count: MAX_TEST_FILES + 1 },
		],
	}
}

// joshuafolkken/kit#6187: the hub is the widest file of the run's own change, not a wider one a main
// merge brought in.
describe('test_related_cap.hub_of', () => {
	it('names the widest file of the own change where the cap cut tests', () => {
		const own = [WIDE_MODULE, MIDDLE_MODULE]

		expect(test_related_cap.hub_of(selection_of(DEFERRED), own)).toBe(WIDE_MODULE)
	})

	it('names no hub where no reached file is of the own change', () => {
		expect(test_related_cap.hub_of(selection_of(DEFERRED), [])).toBeUndefined()
	})

	it('names no hub where the cap cut nothing', () => {
		expect(test_related_cap.hub_of(selection_of(0), [WIDE_MODULE])).toBeUndefined()
	})
})

describe('test_related_cap.deferred_line', () => {
	it('counts the test files run and deferred to CI and names the hub', () => {
		const cap = String(MAX_TEST_FILES)

		expect(test_related_cap.deferred_line(selection_of(DEFERRED), [WIDE_MODULE])).toBe(
			`josh test:related: 1 test files run, ${String(DEFERRED)} deferred to CI past the cap (${cap} test files), hub ${WIDE_MODULE}`,
		)
	})

	it('names no hub where none is of the own change', () => {
		const line = test_related_cap.deferred_line(selection_of(DEFERRED), [])

		expect(line).toContain(`${String(DEFERRED)} deferred to CI`)
		expect(line).not.toContain('hub ')
	})

	it('prints nothing where the cap cut nothing', () => {
		expect(test_related_cap.deferred_line(selection_of(0), [WIDE_MODULE])).toBeUndefined()
	})
})

describe('test_related_cap.report_deferred', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('writes the line to stdout only where the cap cut tests', () => {
		const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

		test_related_cap.report_deferred(selection_of(0), [WIDE_MODULE])
		test_related_cap.report_deferred(selection_of(DEFERRED), [WIDE_MODULE])

		expect(write).toHaveBeenCalledOnce()
		expect(write).toHaveBeenCalledWith(expect.stringContaining('deferred to CI'))
	})
})

describe('test_related_cap.hubs_of', () => {
	let fixture: FixtureWorkspace

	beforeEach(async () => {
		fixture = await open_fixture()
	})

	afterEach(async () => {
		await git_fixture_workspace.close_workspace(fixture)
	})

	it.each([
		['a planned file past the cap (joshuafolkken/kit#6543)', WIDE_MODULE, MAX_TEST_FILES + 1, true],
		['a file past the cap no test imports directly', LONE_MODULE, MAX_TEST_FILES + 1, true],
		['no file at the cap', WIDE_MODULE, MAX_TEST_FILES, false],
	])('names %s as a hub', async (_, file, count, is_hub) => {
		const hubs = await test_related_cap.hubs_of(fixture.workspace, [file], reader_of(count))

		expect(hubs).toEqual(is_hub ? [file] : [])
	})

	it('names no hub among files each under the cap whose reach sums past it', async () => {
		const files = [WIDE_MODULE, MIDDLE_MODULE]
		const reader = reader_of(MAX_TEST_FILES - 1)

		expect(await test_related_cap.hubs_of(fixture.workspace, files, reader)).toEqual([])
	})

	it('names no hub without a graph', async () => {
		const reader = vi.fn(async (): Promise<undefined> => {
			await Promise.resolve(undefined)
		})

		expect(await test_related_cap.hubs_of(fixture.workspace, [WIDE_MODULE], reader)).toEqual([])
	})

	it('reads no reach for a changed test or a file no longer in the tree', async () => {
		const reader = reader_of(MAX_TEST_FILES + 1)
		const files = [DIRECT_TEST, GONE_MODULE]

		expect(await test_related_cap.hubs_of(fixture.workspace, files, reader)).toEqual([])
		expect(reader).not.toHaveBeenCalled()
	})
})
