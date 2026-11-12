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
		const verdict = {
			kind: VERDICT.FIXED,
			specs: [LOW_COMMENT, FIXED_MEDIUM],
			report: [LOW_COMMENT, FIXED_MEDIUM],
		}

		expect(
			run_ship_review.recorded_specs(verdict, run_ship_review.UNVERIFIED_OUTCOME),
		).toStrictEqual([LOW_COMMENT, 'bug-risks:medium:b.ts:9'])
	})
})

describe('run_ship_review.recorded_specs — real verdicts', () => {
	it.each([
		['passing', `${FIXED_MEDIUM} — Keep this reason.`, true, `${FIXED_MEDIUM} — Keep this reason.`],
		[
			'blocking',
			`${FIXED_MEDIUM} — Keep this reason.\nbug-risks:high:a.ts — Blocking reason.`,
			true,
			'bug-risks:medium:b.ts:9 — Keep this reason.\nbug-risks:high:a.ts — Blocking reason.',
		],
		[
			'scoped failure',
			`${FIXED_MEDIUM} — Keep this reason.`,
			false,
			'bug-risks:medium:b.ts:9 — Keep this reason.',
		],
		['no description', LOW_COMMENT, true, LOW_COMMENT],
		['clean', '', true, ''],
	])(
		'preserves descriptions and only removes stopped fixed marks: %s (ac-71ade449) (ac-76503f90)',
		(_name, text, is_verified, expected) => {
			const verdict = run_ship_review.read_verdict(text)

			expect(verdict.kind).not.toBe(VERDICT.INVALID)
			if (verdict.kind === VERDICT.INVALID) return

			const outcome = is_verified
				? run_ship_review.round_one_outcome(verdict)
				: run_ship_review.UNVERIFIED_OUTCOME

			expect(run_ship_review.recorded_specs(verdict, outcome).join('\n')).toBe(expected)
		},
	)
})
