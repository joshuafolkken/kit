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
		const line = await run_ship_synced_scope.settle(TREE, PAIR)

		expect(line).toContain(`${LINT} and ${TEST} not re-run`)
		expect(line).toContain('2 file(s)')
		expect(record).toHaveBeenCalledWith(review_stamps.lint_related_stamp, TREE)
		expect(record).toHaveBeenCalledWith(review_stamps.test_related_stamp, TREE)
	})

	it('settles over a branch side that moved only by josh run records', async () => {
		read_parts.mockResolvedValue(synced_parts([SYNCED_CODE], [RUN_RECORD]))

		expect(await run_ship_synced_scope.settle(TREE, PAIR)).toBeDefined()
	})

	it('re-records only the checks that were stale', async () => {
		await run_ship_synced_scope.settle(TREE, [LINT])

		expect(record).toHaveBeenCalledOnce()
		expect(record).toHaveBeenCalledWith(review_stamps.lint_related_stamp, TREE)
	})
})

describe('run_ship_synced_scope.settle — where the merge meets the branch', () => {
	it('runs the pair when the merge and the branch changed the same file', async () => {
		read_parts.mockResolvedValue(synced_parts([OWN]))

		expect(await run_ship_synced_scope.settle(TREE, PAIR)).toBeUndefined()
		expect(record).not.toHaveBeenCalled()
	})

	it('runs the pair when a test reaches both a synced module and the branch', async () => {
		split.mockResolvedValue({ left: [SYNCED_CODE], shared: [SHARED_TEST], meeting: [] })

		expect(await run_ship_synced_scope.settle(TREE, PAIR)).toBeUndefined()
	})

	it('runs the pair when the import graph could not split a synced module', async () => {
		split.mockResolvedValue({ left: [], shared: [], meeting: [] })

		expect(await run_ship_synced_scope.settle(TREE, PAIR)).toBeUndefined()
	})
})

describe('run_ship_synced_scope.settle — what only one check reads', () => {
	it('runs test:related when the merge brought in a file every test depends on', async () => {
		read_parts.mockResolvedValue(synced_parts([WHOLE_SUITE]))

		expect(await run_ship_synced_scope.settle(TREE, [TEST])).toBeUndefined()
		expect(record).not.toHaveBeenCalled()
	})

	it('runs test:related when a recorded test reads a synced non-code file', async () => {
		readers.mockReturnValue([SHARED_TEST])

		expect(await run_ship_synced_scope.settle(TREE, [TEST])).toBeUndefined()
		expect(readers).toHaveBeenCalledWith(MAP, SYNCED_DOC)
	})

	it('runs test:related over a synced non-code file when no read map was recorded', async () => {
		read_map.mockReturnValue(undefined)

		expect(await run_ship_synced_scope.settle(TREE, [TEST])).toBeUndefined()
	})

	it('runs lint:related when the merge brought in a module every test depends on', async () => {
		read_parts.mockResolvedValue(synced_parts([WHOLE_SUITE_CODE]))

		expect(whole_suite_files.WHOLE_SUITE_FILES.has(WHOLE_SUITE_CODE)).toBe(true)
		expect(await run_ship_synced_scope.settle(TREE, [LINT])).toBeUndefined()
	})

	it('runs lint:related when a file between reaches both a synced module and the branch', async () => {
		split.mockResolvedValue({ left: [SYNCED_CODE], shared: [], meeting: [OWN] })

		expect(await run_ship_synced_scope.settle(TREE, [LINT])).toBeUndefined()
	})

	it('still settles test:related over code only lint reads between the two', async () => {
		split.mockResolvedValue({ left: [SYNCED_CODE], shared: [], meeting: [OWN] })
		read_parts.mockResolvedValue(synced_parts([SYNCED_CODE]))

		expect(await run_ship_synced_scope.settle(TREE, [TEST])).toBeDefined()
	})

	it('still settles lint:related over what only tests read', async () => {
		read_parts.mockResolvedValue(synced_parts([WHOLE_SUITE, SYNCED_DOC]))
		read_map.mockReturnValue(undefined)

		expect(await run_ship_synced_scope.settle(TREE, [LINT])).toBeDefined()
	})
})

describe('run_ship_synced_scope.settle — what cannot be read settles nothing', () => {
	it('runs the pair when the branch side moved since its record', async () => {
		read_parts.mockResolvedValue(synced_parts([SYNCED_CODE], [OWN]))

		expect(await run_ship_synced_scope.settle(TREE, PAIR)).toBeUndefined()
	})

	it('runs the pair when a record cannot be compared', async () => {
		read_parts.mockResolvedValueOnce(synced_parts([SYNCED_CODE])).mockResolvedValueOnce(undefined)

		expect(await run_ship_synced_scope.settle(TREE, PAIR)).toBeUndefined()
	})

	it('runs the pair when no merge moved anything', async () => {
		read_parts.mockResolvedValue(synced_parts([]))

		expect(await run_ship_synced_scope.settle(TREE, PAIR)).toBeUndefined()
	})

	it('runs the pair when git cannot read the branch change', async () => {
		read_branch.mockRejectedValue(new Error('git failed'))

		expect(await run_ship_synced_scope.settle(TREE, PAIR)).toBeUndefined()
	})

	it('settles nothing when no check is stale', async () => {
		expect(await run_ship_synced_scope.settle(TREE, [])).toBeUndefined()
		expect(read_parts).not.toHaveBeenCalled()
	})
})
