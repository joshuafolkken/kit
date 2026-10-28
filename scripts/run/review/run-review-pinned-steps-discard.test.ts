import { randomUUID } from 'node:crypto'
import { core_budget } from '#scripts/gate/core-budget'
import { process_identity } from '#scripts/josh/process-identity'
import { test_pinned_ledger } from '#scripts/test/test-pinned-ledger'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_steps } from './run-review-steps'

// joshuafolkken/kit#5262: a background check stopped while it runs writes no ledger row of its own, so
// the stop writes a discarded one with the wall time since the launch.

const ROOT = `/nonexistent/run-review-pinned-discard-${randomUUID()}`
const PID = 5262
const START = 'Wed Oct 28 09:00:00 2026'
const LAUNCHED_AT = 1_000_000
const RAN_MS = 90_000
const BACKGROUND = 'run-review'
const PRE_DETACH = 'pre-detach'
// Past the join's 120s grace after the pair.
const CAP_PASSED = 120_001

// A clock that reads 0 when the wait starts and past the grace on every read after it.
function capped_clock(): () => number {
	let reads = 0

	return function now(): number {
		reads += 1

		return reads === 1 ? 0 : CAP_PASSED
	}
}

beforeEach(() => {
	vi.spyOn(run_review_steps, 'launch_josh').mockReturnValue({ kind: 'launched', pid: PID })
	vi.spyOn(process_identity, 'read_start').mockReturnValue(START)
	// No test may reach a real process.
	vi.spyOn(process, 'kill').mockReturnValue(true)
})

afterEach(() => {
	vi.restoreAllMocks()
	run_review_pinned_steps.clear(ROOT)
})

describe('run_review_pinned_steps.clear — a discarded check', () => {
	it('writes a discarded ledger row with the wall time since the launch', () => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(true)
		const discarded = vi.spyOn(test_pinned_ledger, 'record_discarded').mockResolvedValue()
		const now = vi.spyOn(Date, 'now').mockReturnValue(LAUNCHED_AT)

		run_review_pinned_steps.launch(ROOT)
		now.mockReturnValue(LAUNCHED_AT + RAN_MS)
		run_review_pinned_steps.clear(ROOT)

		expect(discarded).toHaveBeenCalledWith(RAN_MS, BACKGROUND)
	})

	it('writes no discarded row when the last check is gone', () => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(false)
		const discarded = vi.spyOn(test_pinned_ledger, 'record_discarded').mockResolvedValue()

		run_review_pinned_steps.launch(ROOT)
		run_review_pinned_steps.clear(ROOT)

		expect(discarded).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#5327: the pre-detach's probe of the hunks past its first unpinned one.
describe('run_review_pinned_steps.launch_remaining', () => {
	it('probes every hunk with no reason, on the stamp the next pre-detach joins', () => {
		run_review_pinned_steps.launch_remaining(ROOT, 'tree')

		expect(run_review_steps.launch_josh).toHaveBeenCalledWith(
			['test:pinned', '--origin', PRE_DETACH, '--record', expect.any(String)],
			run_review_pinned_steps.log_path(ROOT),
			ROOT,
		)
		expect(run_review_pinned_steps.launched_tree(ROOT)).toBe('tree')
		expect(run_review_pinned_steps.launched_reason(ROOT)).toBeUndefined()
	})

	it('is discarded under its own origin by the clear a moved tree or the next launch runs', () => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(true)
		const discarded = vi.spyOn(test_pinned_ledger, 'record_discarded').mockResolvedValue()
		const now = vi.spyOn(Date, 'now').mockReturnValue(LAUNCHED_AT)

		run_review_pinned_steps.launch_remaining(ROOT)
		now.mockReturnValue(LAUNCHED_AT + RAN_MS)
		run_review_pinned_steps.clear(ROOT)

		expect(discarded).toHaveBeenCalledWith(RAN_MS, PRE_DETACH)
		expect(process.kill).toHaveBeenCalledWith(-PID, 'SIGTERM')
	})
})

describe('run_review_pinned_steps.wait_for_answer — a late check discarded', () => {
	it('writes a discarded ledger row with the wall time once the grace has passed', async () => {
		vi.spyOn(core_budget, 'live_reservations').mockReturnValue([])
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(undefined)
		const discarded = vi.spyOn(test_pinned_ledger, 'record_discarded').mockResolvedValue()
		const now = vi.spyOn(Date, 'now').mockReturnValue(LAUNCHED_AT)

		run_review_pinned_steps.launch(ROOT)
		now.mockReturnValue(LAUNCHED_AT + RAN_MS)
		await run_review_pinned_steps.wait_for_answer(ROOT, capped_clock(), false)

		expect(discarded).toHaveBeenCalledWith(RAN_MS, BACKGROUND)
	})
})
