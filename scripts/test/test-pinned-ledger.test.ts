import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { lane_paths } from '#scripts/lane/lane-paths'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_ledger } from './test-pinned-ledger'

const FILE = 'scripts/a.ts'
const PROBE = { file: FILE, tests: 2, elapsed_ms: 1500 }

afterEach(() => {
	vi.restoreAllMocks()
})

describe('test_pinned_ledger.record', () => {
	it('writes one test-pinned row with the lane, the held count and each probe', async () => {
		vi.spyOn(lane_paths, 'lane_issue_of').mockReturnValue('5078')
		const write = vi.spyOn(lane_ledger_write, 'record_test_pinned').mockResolvedValue()

		await test_pinned_ledger.record(3, [PROBE], 2000)

		expect(write).toHaveBeenCalledWith({ issue: 5078, held: 3, probes: [PROBE], elapsed_ms: 2000 })
	})

	it('leaves the lane out of a run outside a lane', async () => {
		vi.spyOn(lane_paths, 'lane_issue_of').mockReturnValue(undefined)
		const write = vi.spyOn(lane_ledger_write, 'record_test_pinned').mockResolvedValue()

		await test_pinned_ledger.record(0, [], 10)

		expect(write).toHaveBeenCalledWith({ issue: undefined, held: 0, probes: [], elapsed_ms: 10 })
	})
})

describe('test_pinned_ledger.time_of', () => {
	it("takes the hunk's file and the test files its run ran", () => {
		const hunk = { file: FILE, new_start: 1, new_count: 1, old_lines: [] }

		expect(test_pinned_ledger.time_of(hunk, { verdict: 'red', failed: [], ran: 2 }, 1500)).toEqual(
			PROBE,
		)
	})
})
