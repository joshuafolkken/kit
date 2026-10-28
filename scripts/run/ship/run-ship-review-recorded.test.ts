import { describe, expect, it } from 'vitest'
import { run_ship_review } from './run-ship-review'

// joshuafolkken/kit#5286: a fixed finding is recorded with its `fixed` mark only when its round passed.

const { VERDICT } = run_ship_review
const FIXED_MEDIUM = `${run_ship_review.FIXED_PREFIX}bug-risks:medium:b.ts:9`
const LOW_COMMENT = 'comments:low:a.ts'

describe('run_ship_review.recorded_specs', () => {
	it('records a passing round with its fixed marks', () => {
		const verdict = { kind: VERDICT.FIXED, specs: [FIXED_MEDIUM], report: [FIXED_MEDIUM] }
		const passing = run_ship_review.round_one_outcome(verdict)

		expect(run_ship_review.recorded_specs(verdict, passing)).toStrictEqual([FIXED_MEDIUM])
	})

	it('drops the fixed marks of a stopped round, so the fix is recorded as unfixed', () => {
		const verdict = { kind: VERDICT.FIXED, specs: [LOW_COMMENT, FIXED_MEDIUM], report: [] }

		expect(
			run_ship_review.recorded_specs(verdict, run_ship_review.UNVERIFIED_OUTCOME),
		).toStrictEqual([LOW_COMMENT, 'bug-risks:medium:b.ts:9'])
	})
})
