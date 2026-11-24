import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ChangedParts } from '#scripts/git/changed-paths'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { lane_paths } from '#scripts/lane/lane-paths'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { test_related_caller } from './test-related-caller'
import { test_related_record, type RunInput } from './test-related-record'
import { test_related_record_fixture } from './test-related-record-fixture'
import { related_scope } from './test-related-scope'
import { unit_count_file } from './unit-count-file'

// joshuafolkken/kit#4465: what one `josh test:related` run leaves in the lane ledger; what the cap
// deferred is `test-related-record-deferred.test.ts`'s.

const { ROOT, OWN_CHANGE, SYNCED_CHANGE, SINCE_MAP_CHANGE, READER_TEST, related_input } =
	test_related_record_fixture
const TEST_FILES = 7
const ELAPSED_MS = 1234.6
const LANE_ISSUE = 5532

const make_directory = temporary_directory('suite')
const scratch = make_directory('test-related-record-test-')

afterEach(() => {
	vi.unstubAllEnvs()
})

function count_target(): string {
	return String(process.env[unit_count_file.COUNT_FILE_ENVIRONMENT])
}

describe('test_related_record.record_of', () => {
	it('splits the input into the change, the main sync part, the since-map part and the readers', () => {
		vi.stubEnv(test_related_caller.CALLER_ENVIRONMENT, '')

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
			caller: 'manual',
			elapsed_ms: Math.round(ELAPSED_MS),
		})
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

// joshuafolkken/kit#7248: the test selection's own time, apart from vitest's.
describe('test_related_record.record_of — the test selection time', () => {
	it('records the selection time rounded to a whole millisecond', () => {
		const input = { ...related_input(), select_elapsed_ms: ELAPSED_MS }
		const record = test_related_record.record_of(input, { elapsed_ms: 0, test_files: undefined })

		expect(record.select_elapsed_ms).toBe(Math.round(ELAPSED_MS))
	})

	it('leaves the selection time out where the run measured none', () => {
		const record = test_related_record.record_of(related_input(), {
			elapsed_ms: 0,
			test_files: undefined,
		})

		expect(record).not.toHaveProperty('select_elapsed_ms')
	})
})

// joshuafolkken/kit#7980: whether the tests were chosen by declaration users or by the import graph.
describe('test_related_record.record_of — the selection method', () => {
	const result = { elapsed_ms: 0, test_files: undefined }

	it('records the method the selection used', () => {
		const input = { ...related_input(), select_method: 'symbol' as const }

		expect(test_related_record.record_of(input, result).select_method).toBe('symbol')
	})

	it('leaves the method out where the run selected nothing', () => {
		expect(test_related_record.record_of(related_input(), result)).not.toHaveProperty(
			'select_method',
		)
	})
})

// joshuafolkken/kit#6982: a swollen `changed` is told apart by its half and its base.
describe('test_related_record.record_of — the branch change by half and base', () => {
	it('counts the tracked and untracked halves and names the base', () => {
		const parts = { tracked: [OWN_CHANGE], untracked: [SYNCED_CHANGE, READER_TEST] }
		const input: RunInput = { ...related_input(), branch_parts: { ...parts, base: 'fallback' } }
		const record = test_related_record.record_of(input, { elapsed_ms: 0, test_files: undefined })

		expect(record).toMatchObject({
			branch_tracked: 1,
			branch_untracked: 2,
			branch_base: 'fallback',
		})
	})

	it('leaves the halves out where git could not read them', () => {
		const record = test_related_record.record_of(related_input(), {
			elapsed_ms: 0,
			test_files: undefined,
		})

		expect(record).not.toHaveProperty('branch_base')
		expect(record).not.toHaveProperty('branch_tracked')
		expect(record).not.toHaveProperty('changed_in_branch')
	})
})

// joshuafolkken/kit#7066: a swollen `changed` is told apart by how much of it the branch change holds.
describe('test_related_record.record_of — the change inside and outside the branch', () => {
	const branch_parts: ChangedParts = { tracked: [OWN_CHANGE], untracked: [], base: 'merge_base' }
	const named = 'scripts/named.ts'

	it('counts a named file the branch change does not hold apart from the branch change', () => {
		const base = related_input()
		const input: RunInput = { ...base, changed: [...(base.changed ?? []), named], branch_parts }
		const record = test_related_record.record_of(input, { elapsed_ms: 0, test_files: undefined })

		expect(record).toMatchObject({ changed: 2, changed_in_branch: 1, changed_off_branch: 1 })
	})

	it('counts a bare run whose own change is the branch change wholly inside it', () => {
		const input: RunInput = { ...related_input(), branch: [OWN_CHANGE], branch_parts }
		const record = test_related_record.record_of(input, { elapsed_ms: 0, test_files: undefined })

		expect(record).toMatchObject({ changed: 1, changed_in_branch: 1, changed_off_branch: 0 })
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
