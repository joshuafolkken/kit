import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { describe, expect, it } from 'vitest'
import { run_ship_review } from './run-ship-review'

// joshuafolkken/kit#2427: the supervised reviewer's prompt, and the verdict the supervisor routes on.

const { VERDICT } = run_ship_review
const BRIEF = 'stamps/josh-ship-review-brief-x.md'
const FINDINGS = 'stamps/josh-ship-review-findings-x.txt'

describe('run_ship_review.reviewer_prompt', () => {
	it('is one launch-safe line naming the brief and the findings file', () => {
		const prompt = run_ship_review.reviewer_prompt(BRIEF, FINDINGS)

		expect(prompt).not.toMatch(/\n/u)
		expect(agent_role_profile.is_safe_value(prompt)).toBe(true)
		expect(prompt).toContain(BRIEF)
		expect(prompt).toContain(FINDINGS)
		expect(prompt).toContain('review:attest')
	})
})

describe('run_ship_review.read_verdict', () => {
	it('reads an empty file as a clean round with no findings', () => {
		expect(run_ship_review.read_verdict('\n')).toStrictEqual({ kind: VERDICT.CLEAN, specs: [] })
	})

	it('reads Low-only findings as clean, keeping them to record', () => {
		const text = 'tests:low:scripts/a.ts:3\ncomments:low:scripts/b.ts\n'

		expect(run_ship_review.read_verdict(text)).toStrictEqual({
			kind: VERDICT.CLEAN,
			specs: ['tests:low:scripts/a.ts:3', 'comments:low:scripts/b.ts'],
		})
	})

	it.each(['medium', 'high'])('blocks on a %s finding', (severity) => {
		const text = `comments:low:a.ts\nbug-risks:${severity}:b.ts:9`

		expect(run_ship_review.read_verdict(text).kind).toBe(VERDICT.BLOCKING)
	})

	it('refuses a line outside the review:record grammar', () => {
		const verdict = run_ship_review.read_verdict('bug-risks:critical:a.ts')

		expect(verdict).toStrictEqual({
			kind: VERDICT.INVALID,
			note: 'unreadable finding: bug-risks:critical:a.ts',
		})
	})

	it('reads a missing findings file as an unfinished review, never as clean', () => {
		expect(run_ship_review.read_verdict(undefined).kind).toBe(VERDICT.INVALID)
	})
})

// joshuafolkken/kit#2489: the round-1 reviewer fixes its local Mediums in place and marks them, and the
// supervisor ships on through a round-2 pass rather than handing the lane child back.
describe('run_ship_review.read_verdict — findings fixed in place', () => {
	const FIXED_MEDIUM = `${run_ship_review.FIXED_PREFIX}bug-risks:medium:b.ts:9`

	it('reads a fixed Medium as fixed, recording it without the mark', () => {
		expect(run_ship_review.read_verdict(`comments:low:a.ts\n${FIXED_MEDIUM}`)).toStrictEqual({
			kind: VERDICT.FIXED,
			specs: ['comments:low:a.ts', 'bug-risks:medium:b.ts:9'],
		})
	})

	it('still blocks on a Medium left unfixed beside a fixed one', () => {
		const text = `${FIXED_MEDIUM}\ntests:medium:c.ts`

		expect(run_ship_review.read_verdict(text).kind).toBe(VERDICT.BLOCKING)
	})

	it('blocks on a High even when it is marked fixed — a High is never fixed in place', () => {
		const text = `${run_ship_review.FIXED_PREFIX}bug-risks:high:b.ts`

		expect(run_ship_review.read_verdict(text).kind).toBe(VERDICT.BLOCKING)
	})

	it('refuses a fixed mark over a line outside the grammar', () => {
		const text = `${run_ship_review.FIXED_PREFIX}bug-risks:critical:a.ts`

		expect(run_ship_review.read_verdict(text).kind).toBe(VERDICT.INVALID)
	})
})

describe('run_ship_review — the two rounds route differently', () => {
	const SPECS = ['bug-risks:medium:b.ts']

	it.each([
		[VERDICT.CLEAN, true],
		[VERDICT.FIXED, true],
		[VERDICT.BLOCKING, false],
	] as const)('round 1 reads %s as passing: %s', (kind, is_passing) => {
		expect(run_ship_review.round_one_outcome({ kind, specs: SPECS }).is_passing).toBe(is_passing)
	})

	it.each([
		[VERDICT.CLEAN, true],
		[VERDICT.FIXED, false],
		[VERDICT.BLOCKING, false],
	] as const)('round 2 reads %s as passing: %s', (kind, is_passing) => {
		expect(run_ship_review.round_two_outcome({ kind, specs: SPECS }).is_passing).toBe(is_passing)
	})
})

describe('run_ship_review — the two prompts', () => {
	it('lets round 1 fix a local Medium and asks it to mark what it fixed', () => {
		const prompt = run_ship_review.reviewer_prompt(BRIEF, FINDINGS)

		expect(prompt).toContain('Apply a fix only for a Medium finding')
		expect(prompt).toContain(`"${run_ship_review.FIXED_PREFIX}"`)
		expect(prompt).toContain('never fix a High')
	})

	it('keeps round 2 a launch-safe, read-only verification pass', () => {
		const prompt = run_ship_review.verification_prompt(BRIEF, FINDINGS)

		expect(prompt).not.toMatch(/\n/u)
		expect(agent_role_profile.is_safe_value(prompt)).toBe(true)
		expect(prompt).toContain('round-2 verification pass')
		expect(prompt).toContain('Do not edit any file.')
		expect(prompt).not.toContain(run_ship_review.FIXED_PREFIX.trim())
	})
})
