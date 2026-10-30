import { scoped_green } from '#scripts/gate/scoped-green'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_no_base } from './test-no-base'
import { test_related_record } from './test-related-record'
import type { RelatedInput } from './test-related-red'
import { test_related_reuse } from './test-related-reuse'
import { test_related_run } from './test-related-run'

vi.mock('./test-related-record', () => ({
	test_related_record: { with_test_count: vi.fn(), record_run: vi.fn() },
}))
vi.mock('./test-related-reuse', () => ({
	test_related_reuse: { flags: vi.fn(() => []), blobs: vi.fn(), retained: vi.fn(async () => []) },
}))
vi.mock('./test-related-red', () => ({
	test_related_red: { record_red: vi.fn(), no_base_files: vi.fn(() => []) },
}))
vi.mock('./test-no-base', () => ({ test_no_base: { run_if_touched: vi.fn() } }))
vi.mock('./test-unit-guard', () => ({ test_unit_guard: { is_running: vi.fn(() => true) } }))
vi.mock('#scripts/gate/scoped-green', () => ({ scoped_green: { record_if_green: vi.fn() } }))

const SOURCE = 'source.ts'
const TEST = 'unit.test.ts'
const TREE = { files: { [SOURCE]: 'digest' }, base: 'base' }
const BLOBS = { [TEST]: 'unit-inputs' }

function input(): RelatedInput {
	return {
		root: process.cwd(),
		scope: { mode: 'none', files: [], reason: 'fixture' },
		changed: [],
		synced: [],
		since_map: [],
		owed: [],
	}
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(test_related_record.with_test_count).mockResolvedValue({
		exit_code: 0,
		test_files: 1,
		passed: [TEST],
	})
	vi.mocked(test_no_base.run_if_touched).mockResolvedValue(0)
	vi.mocked(test_related_reuse.blobs).mockResolvedValue(BLOBS)
})

describe('test_related_run.run_and_vouch', () => {
	it('records only reported successful test inputs in the existing scoped stamp', async () => {
		await test_related_run.run_and_vouch(input(), [], TREE)
		expect(test_related_reuse.blobs).toHaveBeenCalledWith(process.cwd(), [TEST])
		expect(scoped_green.record_if_green).toHaveBeenCalledWith(expect.anything(), {
			before: TREE,
			exit_code: 0,
			blobs: BLOBS,
		})
	})
	it.each([1, 2])('does not mint individual success evidence for exit %s', async (exit_code) => {
		vi.mocked(test_related_record.with_test_count).mockResolvedValue({
			exit_code,
			test_files: 1,
			passed: [TEST],
		})
		expect(await test_related_run.run_and_vouch(input(), [], TREE)).toBe(exit_code)
		expect(test_related_reuse.blobs).not.toHaveBeenCalled()
	})
	it('withholds individual evidence when the no-base pass fails', async () => {
		vi.mocked(test_no_base.run_if_touched).mockResolvedValue(1)
		expect(await test_related_run.run_and_vouch(input(), [], TREE)).toBe(1)
		expect(test_related_reuse.blobs).not.toHaveBeenCalled()
	})
})
