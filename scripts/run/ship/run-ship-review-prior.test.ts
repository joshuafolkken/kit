import { review_attest } from '#scripts/review/review-attest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const read_log_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/review/review-stop-log', () => ({ review_stop_log: { read: read_log_mock } }))

const { run_ship_review } = await import('./run-ship-review')

// joshuafolkken/kit#4780: the delta reviewer sees the lane's earlier review findings, so it reports a fix
// that broke the constraint an earlier round set rather than taking it for new code.

const BRIEF = 'stamps/josh-ship-review-brief-x.md'
const CODE_SLOT = review_attest.REVIEW_SLOT.CODE
const ISSUE = '4772'
const PRIOR_LINE = {
	at: '2026-10-25T00:00:00.000Z',
	issue: Number(ISSUE),
	stage: 'review',
	kind: 'bug-risks:medium',
	location: 'tick.ts:187',
	sentence: 'is_live_pid reads EPERM as dead.',
}
const PROMPTS = [
	run_ship_review.reviewer_prompt,
	run_ship_review.report_prompt,
	run_ship_review.verification_prompt,
]

beforeEach(() => {
	read_log_mock.mockReset().mockReturnValue([])
})

describe('run_ship_review prompts — the earlier findings', () => {
	it.each(PROMPTS)('names the earlier findings of the issue on its one line', (prompt_of) => {
		read_log_mock.mockReturnValue([PRIOR_LINE, { ...PRIOR_LINE, issue: 1, sentence: 'other.' }])
		const prompt = prompt_of(BRIEF, CODE_SLOT, ISSUE)

		expect(prompt).not.toMatch(/\n/u)
		expect(prompt).toContain('tick.ts:187 — is_live_pid reads EPERM as dead.')
		expect(prompt).not.toContain('other.')
	})

	it.each(PROMPTS)('reads as before when the lane has no earlier stop', (prompt_of) => {
		const before = prompt_of(BRIEF, CODE_SLOT, ISSUE)

		read_log_mock.mockReturnValue([{ ...PRIOR_LINE, issue: 1 }])

		expect(prompt_of(BRIEF, CODE_SLOT, ISSUE)).toBe(before)
		expect(before).not.toContain('Earlier review rounds')
	})
})

describe('run_ship_review.passing_fixes — what a round that stopped nothing leaves the stop log', () => {
	const FIXED_LINE = 'fixed bug-risks:medium:a.ts:3 — reads EPERM as dead.'
	const PASSING = { is_passing: true, note: '' }

	it('keeps the findings a passing round 1 fixed in place', () => {
		const verdict = run_ship_review.read_verdict(FIXED_LINE)

		if (verdict.kind === run_ship_review.VERDICT.INVALID) throw new Error(verdict.note)

		expect(run_ship_review.passing_fixes(verdict, PASSING)).toStrictEqual([
			{ kind: PRIOR_LINE.kind, location: 'a.ts:3', sentence: 'reads EPERM as dead.' },
		])
		expect(run_ship_review.passing_fixes(verdict, { ...PASSING, is_passing: false })).toStrictEqual(
			[],
		)
	})

	it('keeps nothing from a clean round', () => {
		const verdict = run_ship_review.read_verdict('tests:low:a.ts — a Low.')

		if (verdict.kind === run_ship_review.VERDICT.INVALID) throw new Error(verdict.note)

		expect(run_ship_review.passing_fixes(verdict, PASSING)).toStrictEqual([])
	})
})
