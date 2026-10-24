import { review_attest } from '#scripts/review/review-attest'
import { describe, expect, it } from 'vitest'
import { run_ship_review } from './run-ship-review'

// joshuafolkken/kit#4799: a reviewer that copied the findings path matched `josh-review-*` and
// dropped `ship-`, so a finished review was booked as an infra stop.

const BRIEF = 'stamps/josh-ship-review-brief-x.md'
const ISSUE = '4799'
const { CODE, INTERACTION } = review_attest.REVIEW_SLOT

describe('run_ship_review prompts — findings go to a command, never to a copied path', () => {
	it.each([
		['reviewer', run_ship_review.reviewer_prompt],
		['report', run_ship_review.report_prompt],
		['verification', run_ship_review.verification_prompt],
	])('names no findings path in the %s prompt', (_name, prompt_of) => {
		const prompt = prompt_of(BRIEF, CODE, ISSUE)

		expect(prompt).toContain('`pnpm josh review:submit`')
		expect(prompt).not.toContain('findings-')
		expect(prompt).not.toContain('.txt')
	})

	it('hands the interaction slot the submit command with its flag', () => {
		const prompt = run_ship_review.report_prompt(BRIEF, INTERACTION, ISSUE)

		expect(prompt).toContain('`pnpm josh review:submit --interaction`')
	})

	it('asks for --none, never empty stdin, when there is no finding', () => {
		expect(run_ship_review.reviewer_prompt(BRIEF, CODE, ISSUE)).toContain('`--none`')
	})
})

// A lane branched before `review:submit` runs a josh without it, so its reviewer writes the file.
describe('run_ship_review prompts — a lane whose josh predates review:submit', () => {
	const FINDINGS = 'stamps/josh-ship-review-findings-x.txt'

	it.each([
		['reviewer', run_ship_review.reviewer_prompt],
		['report', run_ship_review.report_prompt],
		['verification', run_ship_review.verification_prompt],
	])('names the findings path in the %s prompt', (_name, prompt_of) => {
		const prompt = prompt_of(BRIEF, CODE, ISSUE, FINDINGS)

		expect(prompt).toContain(`Then write every finding to ${FINDINGS},`)
		expect(prompt).toContain('an empty file when there is none')
		expect(prompt).not.toContain('review:submit')
	})
})
