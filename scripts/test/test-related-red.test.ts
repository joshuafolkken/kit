import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gate_labels } from '#scripts/gate/gate-labels'
import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import { since_green } from '#scripts/gate/since-green'
import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { review_stamps } from '#scripts/review/review-stamps'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_related_red, type RedRun, type RelatedInput } from './test-related-red'
import { vitest_failure_summary } from './vitest-failure-summary'

// joshuafolkken/kit#5386: a red bare run records its failed files, so the run after the fix reads only
// those and what moved since.

const BASE = 'base-sha'
const OTHER_BASE = 'merged-main-sha'
const FAILED_TEST = 'scripts/test/alpha.test.ts'
const OWED_SOURCE = 'scripts/test/beta.ts'
const MOVED_SOURCE = 'scripts/test/gamma.ts'
const BEFORE: GateTree = { files: { [FAILED_TEST]: 'blob-1' }, base: BASE }
const MOVED_TREE: GateTree = { files: { [FAILED_TEST]: 'blob-2' }, base: BASE }
const FAIL_LINE = `FAIL  ${FAILED_TEST} > suite > case\n`
const RED_LOG = `${FAIL_LINE} Test Files  1 failed | 2 passed (3)\n`
const STARTED_MS = 1_000_000
const LOG_WRITTEN_S = 2000
const LOG_STALE_S = 500

const directory = mkdtempSync(path.join(tmpdir(), 'test-related-red-'))
const log_path = path.join(directory, 'unit.log')

function red_run(overrides: Partial<RedRun> = {}): RedRun {
	return {
		before: BEFORE,
		scope: { mode: 'related', files: [FAILED_TEST], reason: '' },
		first_exit: 1,
		started_ms: STARTED_MS,
		owed: [OWED_SOURCE],
		...overrides,
	}
}

function write_log(seconds: number, output = RED_LOG): void {
	writeFileSync(log_path, output)
	utimesSync(log_path, seconds, seconds)
}

function stored(base: string): FileMapStamp {
	return {
		taken_at: '',
		files: BEFORE.files,
		base,
		blobs: { [FAILED_TEST]: 'failed', [OWED_SOURCE]: 'no-base' },
	}
}

beforeEach(() => {
	vi.restoreAllMocks()
	rmSync(log_path, { force: true })
	vi.spyOn(vitest_failure_summary, 'unit_log_path').mockReturnValue(log_path)
	vi.spyOn(gate_tree, 'read_gate_tree').mockResolvedValue(BEFORE)
	vi.spyOn(review_stamps.test_related_red_stamp, 'write').mockReturnValue('')
	vi.spyOn(review_stamps.test_related_red_stamp, 'remove').mockReturnValue()
	vi.spyOn(since_green, 'read_moved_parts').mockResolvedValue({
		changed: [MOVED_SOURCE],
		synced: [],
	})
	vi.spyOn(since_green, 'read_verdict').mockResolvedValue({
		parts: { changed: [MOVED_SOURCE], synced: [] },
	})
})

afterAll(() => {
	rmSync(directory, { recursive: true, force: true })
})

const CLEARS_WHEN = 'clears the record when %s'

// The reviewer's case: a file that passed its tests but leaked a rejection prints no `FAIL` line.
describe('test_related_red.record_red — a red the named files do not account for', () => {
	it.each([
		['an unhandled error failed the run too', `${RED_LOG}⎯⎯ Unhandled Errors ⎯⎯\n`],
		['the summary counts more failed files', `${FAIL_LINE} Test Files  2 failed | 1 passed (3)\n`],
		['the summary names no failed count', FAIL_LINE],
	])(CLEARS_WHEN, async (_case, output) => {
		write_log(LOG_WRITTEN_S, output)

		await test_related_red.record_red(red_run())

		expect(review_stamps.test_related_red_stamp.write).not.toHaveBeenCalled()
		expect(review_stamps.test_related_red_stamp.remove).toHaveBeenCalled()
	})
})

describe('test_related_red.record_red', () => {
	it('records the failed files and the owed no-base files on the before-tree', async () => {
		write_log(LOG_WRITTEN_S)

		await test_related_red.record_red(red_run())

		expect(review_stamps.test_related_red_stamp.write).toHaveBeenCalledWith(
			BEFORE.files,
			undefined,
			BASE,
			{ [OWED_SOURCE]: 'no-base', [FAILED_TEST]: 'failed' },
		)
	})

	it.each([
		['the first pass was green', { first_exit: 0 }],
		['the unit log is older than the run', { started_ms: LOG_STALE_S * 1000 + 1 }],
	])(CLEARS_WHEN, async (_case, overrides) => {
		write_log(LOG_STALE_S)

		await test_related_red.record_red(red_run(overrides))

		expect(review_stamps.test_related_red_stamp.write).not.toHaveBeenCalled()
		expect(review_stamps.test_related_red_stamp.remove).toHaveBeenCalled()
	})

	it('clears the record when the tree moved during the run', async () => {
		write_log(LOG_WRITTEN_S)
		vi.mocked(gate_tree.read_gate_tree).mockResolvedValue(MOVED_TREE)

		await test_related_red.record_red(red_run())

		expect(review_stamps.test_related_red_stamp.remove).toHaveBeenCalled()
	})

	it('leaves the record as it is when the run vouches for no tree', async () => {
		await test_related_red.record_red(red_run({ before: undefined }))

		expect(review_stamps.test_related_red_stamp.write).not.toHaveBeenCalled()
		expect(review_stamps.test_related_red_stamp.remove).not.toHaveBeenCalled()
	})
})

describe('test_related_red.read_red', () => {
	it('reads the failed, owed and moved files on the record base', async () => {
		vi.spyOn(review_stamps.test_related_red_stamp, 'read').mockReturnValue(stored(BASE))

		await expect(test_related_red.read_red(BEFORE)).resolves.toMatchObject({
			failed: [FAILED_TEST],
			owed: [OWED_SOURCE],
			moved: [MOVED_SOURCE],
		})
		expect(since_green.read_moved_parts).toHaveBeenCalledWith(
			review_stamps.test_related_red_stamp,
			gate_labels.UNIT_LABEL,
			undefined,
			BEFORE,
		)
	})

	it('ignores a record written on another base', async () => {
		vi.spyOn(review_stamps.test_related_red_stamp, 'read').mockReturnValue(stored(OTHER_BASE))

		await expect(test_related_red.read_red(BEFORE)).resolves.toBeUndefined()
		expect(since_green.read_moved_parts).not.toHaveBeenCalled()
	})

	it('reads nothing for a run that vouches for no tree', async () => {
		await expect(test_related_red.read_red(undefined)).resolves.toBeUndefined()
	})
})

describe('test_related_red.narrowing', () => {
	it('narrows by the green record when no red one stands', async () => {
		await expect(test_related_red.narrowing(undefined)).resolves.toMatchObject({ failed: [] })
		expect(since_green.read_verdict).toHaveBeenCalledWith(
			review_stamps.test_related_stamp,
			gate_labels.UNIT_LABEL,
		)
	})

	it.each([
		{ red: stored(OTHER_BASE), expected: since_green.FALLBACK.AFTER_RED },
		{ red: undefined, expected: since_green.FALLBACK.NO_RECORD },
	])('answers $expected when the green record falls back', async ({ red, expected }) => {
		vi.spyOn(review_stamps.test_related_red_stamp, 'read').mockReturnValue(red)
		vi.spyOn(since_green, 'read_verdict').mockResolvedValue({
			fallback: since_green.FALLBACK.NO_RECORD,
		})

		await expect(test_related_red.narrowing(undefined)).resolves.toEqual({ fallback: expected })
	})
})

describe('test_related_red.no_base_files', () => {
	it("joins this branch's own files and the owed ones, leaving out what the map or a sync joined", () => {
		const input = {
			scope: { mode: 'none', files: [], reason: '' },
			root: '',
			changed: [FAILED_TEST, MOVED_SOURCE],
			synced: [MOVED_SOURCE],
			since_map: [],
			owed: [OWED_SOURCE, FAILED_TEST],
		} satisfies RelatedInput

		expect(test_related_red.no_base_files(input)).toEqual([FAILED_TEST, OWED_SOURCE])
	})
})

describe('test_related_red.describe', () => {
	it('names the failed and moved counts', () => {
		const reading = {
			parts: { changed: [MOVED_SOURCE], synced: [] },
			moved: [MOVED_SOURCE],
			failed: [FAILED_TEST],
			owed: [],
		}

		expect(test_related_red.describe(reading)).toContain('1 test file(s) that failed')
	})
})
