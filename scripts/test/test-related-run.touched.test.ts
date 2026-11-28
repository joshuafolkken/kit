import { scoped_green } from '#scripts/gate/scoped-green'
import { review_stamps } from '#scripts/review/review-stamps'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_related_record, type RunInput } from './test-related-record'
import { test_related_reuse } from './test-related-reuse'
import { test_related_run } from './test-related-run'

vi.mock('./test-related-record', () => ({
	test_related_record: { with_test_count: vi.fn(), record_run: vi.fn() },
}))
vi.mock('./test-related-reuse', () => ({
	test_related_reuse: {
		flags: vi.fn(() => []),
		blobs: vi.fn(),
		retained: vi.fn(async () => []),
		carried: vi.fn(async () => []),
		touched: vi.fn(async () => []),
	},
}))
vi.mock('./test-related-red', () => ({
	test_related_red: {
		record_red: vi.fn(),
		no_base_files: vi.fn(() => []),
		failed_of: vi.fn(() => []),
	},
}))
vi.mock('./test-no-base', () => ({ test_no_base: { run_if_touched: vi.fn(async () => 0) } }))
vi.mock('./test-unit-guard', () => ({ test_unit_guard: { is_running: vi.fn(() => true) } }))
vi.mock('#scripts/gate/scoped-green', () => ({ scoped_green: { record_if_green: vi.fn() } }))

const SOURCE = 'source.ts'
const TEST = 'unit.test.ts'
const TOUCHED = 'touched.test.ts'
const TREE = { files: { [SOURCE]: 'digest' }, base: 'base' }
const BLOBS = { [TEST]: 'unit-inputs' }

function input(): RunInput {
	return {
		root: process.cwd(),
		scope: { mode: 'none', files: [], reason: 'fixture' },
		changed: [],
		synced: [],
		since_map: [],
	}
}

function exits(exit_code: number): void {
	vi.mocked(test_related_record.with_test_count).mockResolvedValue({
		exit_code,
		test_files: 1,
		passed: [TEST],
	})
}

beforeEach(() => {
	exits(0)
	vi.mocked(test_related_reuse.blobs).mockResolvedValue(BLOBS)
	vi.spyOn(review_stamps.test_related_touched_stamp, 'remove').mockReturnValue(undefined)
})

// joshuafolkken/kit#9163: a touched green hands its passed tests' digests to the full-reach reuse.
describe('test_related_run.run_and_keep', () => {
	it("records a touched green's passed test digests in the touched stamp", async () => {
		expect(await test_related_run.run_and_keep(input(), [], TREE)).toBe(0)
		expect(test_related_reuse.blobs).toHaveBeenCalledWith(process.cwd(), [TEST])
		expect(scoped_green.record_if_green).toHaveBeenCalledWith(
			review_stamps.test_related_touched_stamp,
			{ before: TREE, exit_code: 0, blobs: BLOBS },
		)
	})
	it('drops the touched record on a red run, so a test that just failed is never reused', async () => {
		exits(1)
		expect(await test_related_run.run_and_keep(input(), [], TREE)).toBe(1)
		expect(review_stamps.test_related_touched_stamp.remove).toHaveBeenCalledOnce()
		expect(scoped_green.record_if_green).not.toHaveBeenCalled()
	})
	it('records no digest without a gate tree', async () => {
		await test_related_run.run_and_keep(input(), [], undefined)
		expect(test_related_reuse.blobs).not.toHaveBeenCalled()
	})
})

describe('test_related_run.run_and_vouch — touched carry', () => {
	it("keeps a touched green's still-passing files in the full-reach green record", async () => {
		vi.mocked(test_related_reuse.touched).mockResolvedValue([TOUCHED])
		await test_related_run.run_and_vouch({ ...input(), owed: [] }, [], TREE)
		expect(test_related_reuse.touched).toHaveBeenCalledWith(process.cwd(), TREE)
		expect(test_related_reuse.blobs).toHaveBeenCalledWith(process.cwd(), [TEST, TOUCHED])
	})
})
