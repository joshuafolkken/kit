import type { GateTree } from '#scripts/gate/gate-tree'
import { scoped_green } from '#scripts/gate/scoped-green'
import { since_green } from '#scripts/gate/since-green'
import { changed_file_scope } from '#scripts/git/changed-file-scope'
import { changed_paths } from '#scripts/git/changed-paths'
import { review_stamps } from '#scripts/review/review-stamps'
import { test_read_map, type ReadMap } from '#scripts/test/test-read-map'
import { test_related_synced } from '#scripts/test/test-related-synced'
import { whole_suite_files } from '#scripts/test/whole-suite-files'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_ship_synced_scope } from './run-ship-synced-scope'

// joshuafolkken/kit#4985: a scoped pair stale only because a merge with the default branch moved the
// base runs nothing when the merge shares no file or test with the branch's change.

const LINT = 'lint:related'
const TEST = 'test:related'
const PAIR = [LINT, TEST]
const ROOT = '/repo'
const OWN = 'scripts/own.ts'
const TREE = { files: Object.fromEntries([[OWN, 'digest']]), base: 'new-base' }
const SYNCED_CODE = 'scripts/main-only.ts'
const SYNCED_DOC = 'docs/main-only.md'
const SHARED_TEST = 'scripts/shared.test.ts'
const RUN_RECORD = '.josh/metrics-accepted/4985.json'
const WHOLE_SUITE = [...whole_suite_files.WHOLE_SUITE_FILES][0] ?? ''
const WHOLE_SUITE_CODE = 'scripts/lib/read-file.ts'
const COMPONENT = 'src/lib/Card.svelte'
const MAP: ReadMap = {
	version: 1,
	commit: 'old-base',
	dirty: {},
	change: [],
	directories: [],
	readers: {},
}

const read_parts = vi.spyOn(since_green, 'read_moved_parts')
const read_branch = vi.spyOn(changed_paths, 'read_changed_paths')
const split = vi.spyOn(test_related_synced, 'split')
const record = vi.spyOn(scoped_green, 'record_green')
const read_map = vi.spyOn(test_read_map, 'read_map')
const readers = vi.spyOn(test_read_map, 'readers_of')

function synced_parts(
	synced: ReadonlyArray<string>,
	changed: ReadonlyArray<string> = [],
): { changed: ReadonlyArray<string>; synced: ReadonlyArray<string> } {
	return { changed, synced }
}

async function settle(tree: GateTree, scripts: ReadonlyArray<string>): Promise<string | undefined> {
	const reading = await run_ship_synced_scope.read_sync(tree, scripts)

	return reading === undefined ? undefined : run_ship_synced_scope.settle(reading, tree)
}

beforeEach(() => {
	vi.spyOn(changed_file_scope, 'repository_root_or_cwd').mockResolvedValue(ROOT)
	read_map.mockReset().mockReturnValue(MAP)
	readers.mockReset().mockReturnValue([])
	read_parts.mockReset().mockResolvedValue(synced_parts([SYNCED_CODE, SYNCED_DOC]))
	read_branch.mockReset().mockResolvedValue([OWN])
	split.mockReset().mockResolvedValue({ left: [SYNCED_CODE], shared: [], meeting: [] })
	record.mockReset().mockReturnValue(undefined)
})

describe('run_ship_synced_scope.settle — a merge sharing nothing with the branch', () => {
	it('settles the pair, re-records both checks green on this tree and says why', async () => {
		const line = await settle(TREE, PAIR)

		expect(line).toContain(`${LINT} and ${TEST} not re-run`)
		expect(line).toContain('2 file(s)')
		expect(record).toHaveBeenCalledWith(review_stamps.lint_related_stamp, TREE)
		expect(record).toHaveBeenCalledWith(review_stamps.test_related_stamp, TREE)
	})

	it('settles over a branch side that moved only by josh run records', async () => {
		read_parts.mockResolvedValue(synced_parts([SYNCED_CODE], [RUN_RECORD]))

		expect(await settle(TREE, PAIR)).toBeDefined()
	})

	it('re-records only the checks that were stale', async () => {
		await settle(TREE, [LINT])

		expect(record).toHaveBeenCalledOnce()
		expect(record).toHaveBeenCalledWith(review_stamps.lint_related_stamp, TREE)
	})
})

describe('run_ship_synced_scope.settle — where the merge meets the branch', () => {
	it('runs the pair when the merge and the branch changed the same file', async () => {
		read_parts.mockResolvedValue(synced_parts([OWN]))

		expect(await settle(TREE, PAIR)).toBeUndefined()
		expect(record).not.toHaveBeenCalled()
	})

	it('reads the one file the merge and the branch share as the overlap to narrow to', async () => {
		read_parts.mockResolvedValue(synced_parts([OWN, SYNCED_CODE]))

		const reading = await run_ship_synced_scope.read_sync(TREE, PAIR)

		expect(reading?.overlap).toStrictEqual([OWN])
	})

	it('runs the pair when a test reaches both a synced module and the branch', async () => {
		split.mockResolvedValue({ left: [SYNCED_CODE], shared: [SHARED_TEST], meeting: [] })

		expect(await settle(TREE, PAIR)).toBeUndefined()
	})

	it('runs the pair when the import graph could not split a synced module', async () => {
		const { FAILURE } = test_related_synced

		split.mockResolvedValue({ left: [], shared: [], meeting: [], failure: FAILURE.NO_GRAPH })

		expect(await settle(TREE, PAIR)).toBeUndefined()
	})
})

// joshuafolkken/kit#6185: a failed split named every synced module, 2536 of them in one ship.
describe('run_ship_synced_scope.read_sync — a merge the import graph could not split', () => {
	const { FAILURE } = test_related_synced

	it.each([FAILURE.NO_GRAPH, FAILURE.UNRESOLVED, FAILURE.OWN_UNREAD, FAILURE.THREW])(
		'names nothing and says why when %s',
		async (failure) => {
			split.mockResolvedValue({ left: [], shared: [SHARED_TEST], meeting: [OWN], failure })

			const reading = await run_ship_synced_scope.read_sync(TREE, PAIR)

			expect(reading?.overlap).toBeUndefined()
			expect(reading?.unsplit).toBe(failure)
			expect(await settle(TREE, PAIR)).toBeUndefined()
			expect(record).not.toHaveBeenCalled()
		},
	)

	it('still settles a failed split over a merge that brought in no code', async () => {
		read_parts.mockResolvedValue(synced_parts([SYNCED_DOC]))
		split.mockResolvedValue({ left: [], shared: [], meeting: [], failure: FAILURE.NOTHING_VOUCHED })

		expect(await settle(TREE, [LINT])).toBeDefined()
	})

	it('still names the code a split that succeeded left unsplit', async () => {
		read_parts.mockResolvedValue(synced_parts([SYNCED_CODE, COMPONENT]))

		const reading = await run_ship_synced_scope.read_sync(TREE, [LINT])

		expect(reading?.overlap).toStrictEqual([COMPONENT])
		expect(reading?.unsplit).toBeUndefined()
	})
})

describe('run_ship_synced_scope.settle — what only one check reads', () => {
	it('runs test:related when the merge brought in a file every test depends on', async () => {
		read_parts.mockResolvedValue(synced_parts([WHOLE_SUITE]))

		expect(await settle(TREE, [TEST])).toBeUndefined()
		expect(record).not.toHaveBeenCalled()
	})

	it('runs test:related when a recorded test reads a synced non-code file', async () => {
		readers.mockReturnValue([SHARED_TEST])

		expect(await settle(TREE, [TEST])).toBeUndefined()
		expect(readers).toHaveBeenCalledWith(MAP, SYNCED_DOC)
	})

	it('runs test:related over a synced non-code file when no read map was recorded', async () => {
		read_map.mockReturnValue(undefined)

		expect(await settle(TREE, [TEST])).toBeUndefined()
	})

	it('runs lint:related when the merge brought in a module every test depends on', async () => {
		read_parts.mockResolvedValue(synced_parts([WHOLE_SUITE_CODE]))

		expect(whole_suite_files.WHOLE_SUITE_FILES.has(WHOLE_SUITE_CODE)).toBe(true)
		expect(await settle(TREE, [LINT])).toBeUndefined()
	})

	it('runs lint:related when a file between reaches both a synced module and the branch', async () => {
		split.mockResolvedValue({ left: [SYNCED_CODE], shared: [], meeting: [OWN] })

		expect(await settle(TREE, [LINT])).toBeUndefined()
	})

	it('still settles test:related over code only lint reads between the two', async () => {
		split.mockResolvedValue({ left: [SYNCED_CODE], shared: [], meeting: [OWN] })
		read_parts.mockResolvedValue(synced_parts([SYNCED_CODE]))

		expect(await settle(TREE, [TEST])).toBeDefined()
	})

	it('still settles lint:related over what only tests read', async () => {
		read_parts.mockResolvedValue(synced_parts([WHOLE_SUITE, SYNCED_DOC]))
		read_map.mockReturnValue(undefined)

		expect(await settle(TREE, [LINT])).toBeDefined()
	})
})

// joshuafolkken/kit#6197: the shared tests sit inside the meeting, and one ship logged 119 for 68.
describe('run_ship_synced_scope.read_sync — a file the split names twice', () => {
	it('names a shared test that also sits in the meeting once', async () => {
		split.mockResolvedValue({
			left: [SYNCED_CODE],
			shared: [SHARED_TEST],
			meeting: [SHARED_TEST, OWN],
		})

		const reading = await run_ship_synced_scope.read_sync(TREE, [LINT])

		expect(reading?.overlap).toStrictEqual([SHARED_TEST, OWN])
	})
})

describe('run_ship_synced_scope.settle — what cannot be read settles nothing', () => {
	it('runs the pair when the branch side moved since its record', async () => {
		read_parts.mockResolvedValue(synced_parts([SYNCED_CODE], [OWN]))

		expect(await settle(TREE, PAIR)).toBeUndefined()
	})

	it('runs the pair when a record cannot be compared', async () => {
		read_parts.mockResolvedValueOnce(synced_parts([SYNCED_CODE])).mockResolvedValueOnce(undefined)

		expect(await settle(TREE, PAIR)).toBeUndefined()
	})

	it('runs the pair when no merge moved anything', async () => {
		read_parts.mockResolvedValue(synced_parts([]))

		expect(await settle(TREE, PAIR)).toBeUndefined()
	})

	it('runs the pair when git cannot read the branch change', async () => {
		read_branch.mockRejectedValue(new Error('git failed'))

		expect(await settle(TREE, PAIR)).toBeUndefined()
	})

	it('settles nothing when no check is stale', async () => {
		expect(await settle(TREE, [])).toBeUndefined()
		expect(read_parts).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#7052: a branch of 9 files named test:related over 1,536 of main's after a sync.
describe('run_ship_synced_scope.read_sync — what test:related is named over', () => {
	const BRANCH = [
		'scripts/run/ship/run-ship-scoped.ts',
		'scripts/run/ship/run-ship-synced-scope.ts',
	]
	const MAIN_SIZE = 1500
	const MAIN = Array.from({ length: MAIN_SIZE }, (_, index) => `scripts/main/m${String(index)}.ts`)
	const MAIN_TESTS = MAIN.map((file) => file.replace('.ts', '.test.ts'))
	const MEETS = { left: MAIN, shared: MAIN_TESTS, meeting: [...MAIN, ...MAIN_TESTS] }

	beforeEach(() => {
		vi.spyOn(changed_file_scope, 'repository_root_or_cwd').mockResolvedValue(process.cwd())
		read_parts.mockResolvedValue(synced_parts(MAIN))
		read_branch.mockResolvedValue([...BRANCH, 'scripts/deleted-by-branch.ts'])
		split.mockResolvedValue(MEETS)
	})

	it('names the branch change alone for a merge main brought in only (ac-ea05869a)', async () => {
		const reading = await run_ship_synced_scope.read_sync(TREE, PAIR)

		expect(reading?.test_overlap).toStrictEqual(BRANCH)
		expect(run_ship_synced_scope.files_for(reading, TEST, MAIN)).toStrictEqual(BRANCH)
		expect(run_ship_synced_scope.files_for(reading, LINT, BRANCH)).toBe(reading?.overlap)
	})

	it('names the same set from the same tree and base (ac-5c617617)', async () => {
		const first = await run_ship_synced_scope.read_sync(TREE, PAIR)

		expect(await run_ship_synced_scope.read_sync(TREE, PAIR)).toStrictEqual(first)
	})

	it('keeps the branch change only where a test meets it (ac-62eacc9c)', async () => {
		split.mockResolvedValue({ ...MEETS, shared: [] })

		const reading = await run_ship_synced_scope.read_sync(TREE, PAIR)

		expect(reading?.test_overlap).toStrictEqual([])
		expect(reading?.overlap).toHaveLength(MAIN_SIZE * 2)
	})
})

// joshuafolkken/kit#6279: review can meet a merge and unchecked own edits together.
describe('run_ship_synced_scope.read_sync — own edits after a merge', () => {
	it('names own edits and excludes unrelated main files from the review pair', async () => {
		read_parts.mockResolvedValue(synced_parts([SYNCED_CODE], [OWN, RUN_RECORD]))

		const reading = await run_ship_synced_scope.read_sync(TREE, PAIR)

		expect(reading?.overlap).toStrictEqual([OWN])
		expect(await settle(TREE, PAIR)).toBeUndefined()
		expect(record).not.toHaveBeenCalled()
	})

	it('keeps the main dependency intersection alongside edits from either stale check', async () => {
		read_parts
			.mockResolvedValueOnce(synced_parts([SYNCED_CODE], [OWN]))
			.mockResolvedValueOnce(synced_parts([SYNCED_CODE], [COMPONENT]))
		split.mockResolvedValue({ left: [SYNCED_CODE], shared: [SHARED_TEST], meeting: [] })

		const reading = await run_ship_synced_scope.read_sync(TREE, PAIR)

		expect(reading?.overlap).toStrictEqual([OWN, COMPONENT, SHARED_TEST])
		expect(split).toHaveBeenCalledWith(ROOT, [SYNCED_CODE], [OWN], MAP)
	})
})
