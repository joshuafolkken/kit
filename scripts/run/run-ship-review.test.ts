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
