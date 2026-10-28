import { randomUUID } from 'node:crypto'
import { core_budget, type LiveReservation } from '#scripts/gate/core-budget'
import { process_identity } from '#scripts/josh/process-identity'
import { test_pinned_record } from '#scripts/test/test-pinned-record'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_steps } from './run-review-steps'

// joshuafolkken/kit#4834: `josh run:review --pinned` reads a check `josh review:record` started moments
// before, so it waits through the core queue the join stops at, bounded only against a check that hung.

const ROOT = `/nonexistent/run-review-pinned-alone-${randomUUID()}`
const PID = 4834
const START = 'Sun Oct 25 01:00:00 2026'
const ANSWER = { text: 'unpinned 1 · unchecked 0\n', unpinned: ['a.ts 0123456789abcdef'] }
const ALONE_GRACE_MS = 900_000
const ALONE_TIMED_OUT_NOTE = 'no answer within 900s of the read'
const QUEUED_NOTE = 'it was still waiting for cores when the gate and the review ended'

// A `test:pinned` claim from this checkout that has not been granted its cores yet.
function queued_claim(): LiveReservation {
	return {
		key: 'claim',
		reservation: { pid: PID, weight: 1, claimed_at: 0, command: 'test:pinned', checkout: ROOT },
	}
}

// A clock that reads 0 when the wait starts and `later` on every read after it.
function clock_then(later: number): () => number {
	let reads = 0

	return function now(): number {
		reads += 1

		return reads === 1 ? 0 : later
	}
}

beforeEach(() => {
	vi.spyOn(core_budget, 'live_reservations').mockReturnValue([queued_claim()])
	vi.spyOn(run_review_steps, 'launch_josh').mockReturnValue({ kind: 'launched', pid: PID })
	vi.spyOn(process_identity, 'read_start').mockReturnValue(START)
	vi.spyOn(process_identity, 'is_same_process').mockReturnValue(true)
	vi.spyOn(process, 'kill').mockReturnValue(true)
})

afterEach(() => {
	run_review_pinned_steps.clear(ROOT)
	vi.restoreAllMocks()
})

describe('run_review_pinned_steps.wait_alone', () => {
	it('answers nothing when no check was launched', async () => {
		expect(await run_review_pinned_steps.wait_alone(ROOT)).toBeUndefined()
	})

	it('waits on a queued check for its answer, where the join stops it', async () => {
		run_review_pinned_steps.launch(ROOT)
		const joined = await run_review_pinned_steps.wait_for_answer(ROOT)

		expect(joined?.text).toContain(QUEUED_NOTE)
		run_review_pinned_steps.launch(ROOT)
		const read = vi.spyOn(test_pinned_record, 'read').mockReturnValue(undefined)

		read.mockReturnValueOnce(undefined).mockReturnValueOnce(ANSWER)
		vi.mocked(process.kill).mockClear()

		expect(await run_review_pinned_steps.wait_alone(ROOT, clock_then(0))).toStrictEqual(ANSWER)
		expect(process.kill).not.toHaveBeenCalled()
	})

	it('stops a check still running past its own bound, failing open', async () => {
		run_review_pinned_steps.launch(ROOT)

		const answer = await run_review_pinned_steps.wait_alone(ROOT, clock_then(ALONE_GRACE_MS + 1))

		expect(answer?.unpinned).toStrictEqual([])
		expect(answer?.text).toContain(ALONE_TIMED_OUT_NOTE)
		expect(process.kill).toHaveBeenCalledWith(-PID, 'SIGTERM')
	})
})
