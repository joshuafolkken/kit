import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { lane_paths } from '#scripts/lane/lane-paths'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { test_related_record, type RunInput } from './test-related-record'
import { related_scope } from './test-related-scope'
import { unit_count_file } from './unit-count-file'

// joshuafolkken/kit#4465: what one `josh test:related` run leaves in the lane ledger.

const ROOT = '/repository'
const OWN_CHANGE = 'scripts/own.ts'
const SYNCED_CHANGE = 'scripts/synced.ts'
const SINCE_MAP_CHANGE = 'scripts/since-map.ts'
const READER_TEST = 'scripts/reader.test.ts'
const TEST_FILES = 7
const ELAPSED_MS = 1234.6
const LANE_ISSUE = 5532

const scratch = mkdtempSync(path.join(tmpdir(), 'test-related-record-test-'))

afterEach(() => {
	vi.unstubAllEnvs()
})

afterAll(() => {
	rmSync(scratch, { recursive: true, force: true })
})

function related_input(): RunInput {
	const files = [OWN_CHANGE, SYNCED_CHANGE, SINCE_MAP_CHANGE, READER_TEST].map((file) =>
		path.join(ROOT, file),
	)

	return {
		scope: { mode: 'related', files, reason: '4 related file(s)' },
		root: ROOT,
		changed: [OWN_CHANGE, SYNCED_CHANGE, SINCE_MAP_CHANGE],
		synced: [SYNCED_CHANGE],
		since_map: [SINCE_MAP_CHANGE],
	}
}

function count_target(): string {
	return String(process.env[unit_count_file.COUNT_FILE_ENVIRONMENT])
}

describe('test_related_record.record_of', () => {
	it('splits the input into the change, the main sync part, the since-map part and the readers', () => {
		const record = test_related_record.record_of(related_input(), {
			elapsed_ms: ELAPSED_MS,
			test_files: TEST_FILES,
		})

		expect(record).toEqual({
			scope: 'related',
			changed: 1,
			synced: 1,
			since_map: 1,
			readers: 1,
			test_files: TEST_FILES,
			elapsed_ms: Math.round(ELAPSED_MS),
		})
	})

	it('leaves the test file count out when vitest reported none', () => {
		const record = test_related_record.record_of(related_input(), {
			elapsed_ms: 0,
			test_files: undefined,
		})

		expect(record).not.toHaveProperty('test_files')
	})
})

describe('test_related_record.record_of — reuse evidence', () => {
	it('records reuse and miss counts, their reason and comparison time in the existing ledger shape', () => {
		const reuse = {
			excluded: [],
			reused: 1,
			missed: 1,
			reason: 'closed-inputs-unchanged',
			elapsed_ms: ELAPSED_MS,
		}
		const record = test_related_record.record_of(
			{ ...related_input(), reuse },
			{ elapsed_ms: 0, test_files: 1 },
		)

		expect(record).toMatchObject({
			reused: 1,
			reuse_missed: 1,
			reuse_reason: reuse.reason,
			reuse_elapsed_ms: Math.round(ELAPSED_MS),
		})
	})

	// joshuafolkken/kit#4572: a synced non-code file joins `since_map` as well.
	it('counts a synced file that is also in the since-map part once, as synced', () => {
		const input = { ...related_input(), since_map: [SINCE_MAP_CHANGE, SYNCED_CHANGE] }
		const record = test_related_record.record_of(input, { elapsed_ms: 0, test_files: undefined })

		expect(record).toMatchObject({ changed: 1, synced: 1, since_map: 1 })
	})

	// joshuafolkken/kit#5237: a `--touched` run narrows like any other, yet is recorded as its own kind.
	it('records the run under the kind it was given over its scope mode', () => {
		const input = { ...related_input(), kind: 'touched' }
		const record = test_related_record.record_of(input, { elapsed_ms: 0, test_files: undefined })

		expect(record.scope).toBe('touched')
	})
})

// joshuafolkken/kit#5532: a changed file whose reach passed the cap is counted, an uncapped run is not.
describe('test_related_record.record_of — the reach cap', () => {
	it('counts the over-cap files, and leaves the count out of a run that was not capped', () => {
		const capped = { ...related_input(), over_cap: ['src/a.ts', 'src/b.ts'] }
		const result = { elapsed_ms: 0, test_files: undefined }

		expect(test_related_record.record_of(capped, result).over_cap).toBe(2)
		expect(test_related_record.record_of(related_input(), result)).not.toHaveProperty('over_cap')
	})

	// joshuafolkken/kit#5699: the first over-cap file, the widest reach, is recorded as the hub.
	it('records the first over-cap file as the hub, and none where nothing was capped', () => {
		const capped = { ...related_input(), over_cap: ['src/a.ts', 'src/b.ts'] }
		const uncapped = { ...related_input(), over_cap: [] }
		const result = { elapsed_ms: 0, test_files: undefined }

		expect(test_related_record.record_of(capped, result).over_cap_hub).toBe('src/a.ts')
		expect(test_related_record.record_of(uncapped, result)).not.toHaveProperty('over_cap_hub')
	})
})

// joshuafolkken/kit#5041: a shared test and a synced file the split cannot vouch for are in the change
// without being this branch's.
describe("test_related_record.record_of — the branch's own change", () => {
	it('counts as the change only its files, and a shared test as a reader', () => {
		const shared_test = 'scripts/shared.test.ts'
		const not_vouched = 'tools/gone.ts'
		const base = related_input()
		const input: RunInput = {
			...base,
			scope: { ...base.scope, files: [...base.scope.files, path.join(ROOT, shared_test)] },
			changed: [OWN_CHANGE, SYNCED_CHANGE, SINCE_MAP_CHANGE, shared_test, not_vouched],
			synced: [SYNCED_CHANGE, not_vouched],
			branch: [OWN_CHANGE],
		}
		const record = test_related_record.record_of(input, { elapsed_ms: 0, test_files: undefined })

		expect(record).toMatchObject({ changed: 1, synced: 2, since_map: 1, readers: 2 })
	})
})

describe('test_related_record.record_of — a full-suite run', () => {
	it('names a full-suite run by its fallback kind and an unread change as no input', () => {
		const input: RunInput = {
			scope: { mode: 'all', files: [], reason: related_scope.UNREADABLE_REASON },
			root: ROOT,
			changed: undefined,
			synced: [],
			since_map: [],
		}
		const record = test_related_record.record_of(input, { elapsed_ms: 0, test_files: undefined })

		expect(record).toMatchObject({
			scope: 'unreadable',
			changed: 0,
			synced: 0,
			since_map: 0,
			readers: 0,
		})
		expect(record).not.toHaveProperty('trigger_files')
	})

	it('records the files that sent the run to the whole suite, relative to the root', () => {
		const files = ['package.json', 'pnpm-lock.yaml']
		const input: RunInput = {
			scope: { mode: 'all', files: files.map((file) => path.join(ROOT, file)), reason: '' },
			root: ROOT,
			changed: files,
			synced: [],
			since_map: [],
		}
		const record = test_related_record.record_of(input, { elapsed_ms: 0, test_files: undefined })

		expect(record.trigger_files).toStrictEqual(files)
	})
})

describe('test_related_record.with_test_count', () => {
	it('reads back the count the reporter wrote, and restores the environment', async () => {
		const before = process.env[unit_count_file.COUNT_FILE_ENVIRONMENT]
		const result = await test_related_record.with_test_count(async () => {
			await unit_count_file.write_count(TEST_FILES, count_target())
			await unit_count_file.write_files([READER_TEST], count_target())

			return 1
		})

		expect(result).toEqual({ exit_code: 1, test_files: TEST_FILES, passed: [READER_TEST] })
		expect(process.env[unit_count_file.COUNT_FILE_ENVIRONMENT]).toBe(before)
	})

	it('answers no count when the run wrote none', async () => {
		const result = await test_related_record.with_test_count(async () => 0)

		expect(result).toEqual({ exit_code: 0, test_files: undefined, passed: [] })
	})

	it('still runs, uncounted, when the temp root cannot be written', async () => {
		vi.stubEnv('TMPDIR', path.join(scratch, 'missing', 'temp'))
		const run = vi.fn(async () => 1)

		await expect(test_related_record.with_test_count(run)).resolves.toEqual({
			exit_code: 1,
			test_files: undefined,
		})
		expect(run).toHaveBeenCalledOnce()
	})

	it('answers no count for an unreadable count', async () => {
		const result = await test_related_record.with_test_count(async () => {
			writeFileSync(count_target(), '')

			return 0
		})

		expect(result.test_files).toBeUndefined()
	})
})

describe('test_related_record.record_run', () => {
	it('appends the record to the ledger as a test-related entry', async () => {
		const ledger = path.join(scratch, 'ledger.jsonl')

		await test_related_record.record_run(
			related_input(),
			{ elapsed_ms: 10, test_files: TEST_FILES },
			ledger,
		)

		expect(lane_ledger.read_entries(ledger)).toMatchObject([
			{ kind: lane_ledger.KIND.TEST_RELATED, scope: 'related', test_files: TEST_FILES },
		])
	})

	// joshuafolkken/kit#5532: `josh lane:breakdown` reads a lane's rows by the issue they carry.
	it('records the lane the run ran in', async () => {
		const ledger = path.join(scratch, 'lane-ledger.jsonl')
		const issue_here = vi.spyOn(lane_paths, 'issue_here').mockReturnValue(LANE_ISSUE)

		await test_related_record.record_run(related_input(), { elapsed_ms: 0, test_files: 1 }, ledger)

		expect(lane_ledger.read_entries(ledger)).toMatchObject([{ issue: LANE_ISSUE }])
		issue_here.mockRestore()
	})
})
