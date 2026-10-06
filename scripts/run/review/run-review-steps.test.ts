import { stamp_file } from '#scripts/josh/stamp-file'
import { afterEach, describe, expect, it } from 'vitest'
import { run_review_steps } from './run-review-steps'

// joshuafolkken/kit#2179: the timing record `josh run:review` opens at the start and closes at the
// join, exercised over an isolated target so it never touches the record a real run relies on. The
// four timestamps this round-trips are the ones the overlap in the PR body is measured from.

const START_TARGET = 'run-review-steps-test-start'
const MISSING_TARGET = 'run-review-steps-test-missing'
const ENDED = {
	gate_ended_at: '2026-09-20T10:00:30.000Z',
	review_ended_at: '2026-09-20T10:02:12.000Z',
}
const START = {
	gate_started_at: '2026-09-20T10:00:00.000Z',
	review_started_at: '2026-09-20T10:00:02.000Z',
}

afterEach(() => {
	for (const target of [START_TARGET, MISSING_TARGET]) {
		stamp_file.remove_stamp(run_review_steps.timing_path(target))
	}
})

describe('the timing record round-trip', () => {
	it('reads back the start it was written', () => {
		run_review_steps.write_timing_start(START, START_TARGET)

		expect(run_review_steps.read_timing_start(START_TARGET)).toStrictEqual(START)
	})

	it('completes the start into the full four-timestamp timing', () => {
		run_review_steps.write_timing_start(START, START_TARGET)

		expect(run_review_steps.complete_timing(ENDED, START_TARGET)).toStrictEqual({
			...START,
			...ENDED,
		})
	})

	it('reads no record as undefined rather than an empty timing', () => {
		expect(run_review_steps.read_timing_start(MISSING_TARGET)).toBeUndefined()
	})

	it('cannot complete a timing whose start was never opened', () => {
		expect(run_review_steps.complete_timing(ENDED, MISSING_TARGET)).toBeUndefined()
	})
})
