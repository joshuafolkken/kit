import { describe, expect, it } from 'vitest'
import { run_ship_review } from './run-ship-review'

// joshuafolkken/kit#4715: "Run a /code-review" sent the reviewer to the skill, which forked a second
// agent that read the same diff and brief again.

const BRIEF = 'stamps/josh-ship-review-brief-x.md'
const FINDINGS = 'stamps/josh-ship-review-findings-x.txt'
const ISSUE = '4715'

describe('run_ship_review prompts — the review runs in the launched session', () => {
	it.each([
		['reviewer', run_ship_review.reviewer_prompt],
		['report', run_ship_review.report_prompt],
		['verification', run_ship_review.verification_prompt],
	])(
		'asks the %s session to review in itself, never through a nested agent',
		(_name, prompt_of) => {
			const prompt = prompt_of(BRIEF, FINDINGS, ISSUE)

			expect(prompt).toContain('Review it yourself in this session')
			expect(prompt).not.toContain('Run a /code-review')
		},
	)
})
