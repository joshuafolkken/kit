import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { lane_paths } from '#scripts/lane/lane-paths'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_ledger } from './test-pinned-ledger'

const FILE = 'scripts/a.ts'
const PROBE = { file: FILE, tests: 2, elapsed_ms: 1500 }
const BACKGROUND = 'run-review'
const PRE_DETACH = 'pre-detach'

afterEach(() => {
	vi.restoreAllMocks()
})

describe('test_pinned_ledger.record', () => {
	it('writes one test-pinned row with the lane, the held and rewired counts and each probe', async () => {
		vi.spyOn(lane_paths, 'lane_issue_of').mockReturnValue('5078')
		const write = vi.spyOn(lane_ledger_write, 'record_test_pinned').mockResolvedValue()

		await test_pinned_ledger.record({ held: 3, rewired: 2, origin: PRE_DETACH }, [PROBE], 2000)

		expect(write).toHaveBeenCalledWith({
			issue: 5078,
			held: 3,
			rewired: 2,
			probes: [PROBE],
			elapsed_ms: 2000,
			origin: PRE_DETACH,
		})
	})

	it('leaves the lane out of a run outside a lane, and names an unnamed origin manual', async () => {
		vi.spyOn(lane_paths, 'lane_issue_of').mockReturnValue(undefined)
		const write = vi.spyOn(lane_ledger_write, 'record_test_pinned').mockResolvedValue()

		await test_pinned_ledger.record({ held: 0, rewired: 0 }, [], 10)

		expect(write).toHaveBeenCalledWith({
			issue: undefined,
			held: 0,
			rewired: 0,
			probes: [],
			elapsed_ms: 10,
			origin: 'manual',
		})
	})
})

describe('test_pinned_ledger.record_discarded', () => {
	it('writes a discarded run:review row with the wall time and nothing probed', async () => {
		vi.spyOn(lane_paths, 'lane_issue_of').mockReturnValue('5262')
		const write = vi.spyOn(lane_ledger_write, 'record_test_pinned').mockResolvedValue()

		await test_pinned_ledger.record_discarded(90_000)

		expect(write).toHaveBeenCalledWith({
			issue: 5262,
			held: 0,
			probes: [],
			elapsed_ms: 90_000,
			origin: BACKGROUND,
			discarded: true,
		})
	})

	// joshuafolkken/kit#5327: the pre-detach's probe past its stop is written under its own origin.
	it('writes the origin it is given', async () => {
		vi.spyOn(lane_paths, 'lane_issue_of').mockReturnValue('5327')
		const write = vi.spyOn(lane_ledger_write, 'record_test_pinned').mockResolvedValue()

		await test_pinned_ledger.record_discarded(90_000, PRE_DETACH)

		expect(write).toHaveBeenCalledWith(expect.objectContaining({ origin: PRE_DETACH }))
	})
})

describe('test_pinned_ledger.origin_of', () => {
	it('reads each of the three origins, none as manual, and any other as undefined', () => {
		expect(test_pinned_ledger.origin_of(PRE_DETACH)).toBe(PRE_DETACH)
		expect(test_pinned_ledger.origin_of(BACKGROUND)).toBe(BACKGROUND)
		expect(test_pinned_ledger.origin_of(undefined)).toBe('manual')
		expect(test_pinned_ledger.origin_of('ship')).toBeUndefined()
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
