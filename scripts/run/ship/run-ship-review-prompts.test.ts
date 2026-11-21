import { review_attest } from '#scripts/review/review-attest'
import { review_prompt_level } from '#scripts/review/review-prompt-level'
import { describe, expect, it } from 'vitest'
import { run_ship_review } from './run-ship-review'
import { run_ship_review_prompts } from './run-ship-review-prompts'

// joshuafolkken/kit#8378: the reviewer launch prompts, moved out of `run-ship-review.ts` unchanged.

const BRIEF = 'stamps/josh-ship-review-brief-prompts.md'
const ISSUE = '8378'
const FINDINGS = 'stamps/josh-ship-review-findings.md'
const { CODE, INTERACTION } = review_attest.REVIEW_SLOT
const SUBMIT = 'pnpm josh review:submit'
const READ_ONLY = 'Do not edit any file'
const FIXED_CLAUSE = 'prefixing a finding you fixed'

describe('run_ship_review_prompts.submit_command', () => {
	it('names the code slot bare and the interaction slot with its flag', () => {
		expect(run_ship_review_prompts.submit_command(CODE)).toBe(SUBMIT)
		expect(run_ship_review_prompts.submit_command(INTERACTION)).toBe(`${SUBMIT} --interaction`)
	})
})

describe('run_ship_review_prompts.round_one_opening', () => {
	it('leads with the trigger, names the brief and keeps the review in this session', () => {
		const opening = run_ship_review_prompts.round_one_opening(BRIEF, 'initial')

		expect(review_prompt_level.trigger_of(opening)).toBe('initial')
		expect(opening).toContain(BRIEF)
		expect(opening).toContain('never launch a second reviewer')
	})
})

describe('run_ship_review_prompts.reviewer_prompt', () => {
	it('asks for the fixed mark and pipes findings to the submit command', () => {
		const prompt = run_ship_review_prompts.reviewer_prompt(BRIEF, CODE, ISSUE)

		expect(prompt).toContain(
			`prefixing a finding you fixed with "${run_ship_review_prompts.FIXED_PREFIX}"`,
		)
		expect(prompt).toContain(`\`${SUBMIT}\``)
		expect(prompt).toContain(run_ship_review_prompts.OTHER_SITES_CLAUSE)
		expect(prompt).toContain(`pnpm josh issue:read ${ISSUE}`)
	})

	it('hands a lane whose josh predates review:submit the findings path instead', () => {
		const prompt = run_ship_review_prompts.reviewer_prompt(BRIEF, CODE, ISSUE, FINDINGS)

		expect(prompt).toContain(`Then write every finding to ${FINDINGS},`)
		expect(prompt).not.toContain(SUBMIT)
	})
})

// joshuafolkken/kit#8379: a rerun's launches name their cause in place of the slot's word.
describe('run_ship_review_prompts.round_one_prompt', () => {
	const { STALE } = review_prompt_level.RETRY
	const BOTH = [CODE, INTERACTION]

	function trigger_beside(prompt_of: ReturnType<typeof run_ship_review_prompts.retried>): unknown {
		const beside = run_ship_review_prompts.slot_prompt(prompt_of, INTERACTION, BOTH)

		return review_prompt_level.trigger_of(beside(BRIEF, INTERACTION, ISSUE))
	}

	it('opens the code slot and the read-only slot beside it with the retry', () => {
		const prompt_of = run_ship_review_prompts.round_one_prompt(STALE)
		const beside = run_ship_review_prompts.slot_prompt(prompt_of, INTERACTION, BOTH)

		expect(review_prompt_level.trigger_of(prompt_of(BRIEF, CODE, ISSUE))).toBe(STALE)
		expect(trigger_beside(prompt_of)).toBe(STALE)
		expect(beside(BRIEF, INTERACTION, ISSUE)).toContain(READ_ONLY)
		expect(prompt_of(BRIEF, CODE, ISSUE)).toContain(FIXED_CLAUSE)
	})

	it('keeps the slot words for a first run', () => {
		const prompt_of = run_ship_review_prompts.round_one_prompt(undefined)

		expect(prompt_of).toBe(run_ship_review_prompts.reviewer_prompt)
		expect(review_prompt_level.trigger_of(prompt_of(BRIEF, CODE, ISSUE))).toBe('initial')
		expect(trigger_beside(prompt_of)).toBe('interaction')
	})
})

describe('run_ship_review_prompts.report_prompt and verification_prompt', () => {
	it('keeps the report beside the code review read only, without the fixed mark', () => {
		const prompt = run_ship_review_prompts.report_prompt(BRIEF, INTERACTION, ISSUE)

		expect(review_prompt_level.trigger_of(prompt)).toBe('interaction')
		expect(prompt).toContain(READ_ONLY)
		expect(prompt).toContain(`\`${SUBMIT} --interaction\``)
		expect(prompt).not.toContain(FIXED_CLAUSE)
	})

	it('opens round 2 as the final read-only pass', () => {
		const prompt = run_ship_review_prompts.verification_prompt(BRIEF, CODE, ISSUE)

		expect(prompt.startsWith(run_ship_review_prompts.final_opening(BRIEF))).toBe(true)
		expect(review_prompt_level.trigger_of(prompt)).toBe('round-2')
		expect(prompt).toContain(READ_ONLY)
	})
})

describe('run_ship_review_prompts.slot_prompt', () => {
	const { reviewer_prompt, report_prompt, slot_prompt } = run_ship_review_prompts

	it('keeps the round prompt for the code slot and a slot reviewed alone', () => {
		expect(slot_prompt(reviewer_prompt, CODE, [CODE, INTERACTION])).toBe(reviewer_prompt)
		expect(slot_prompt(reviewer_prompt, INTERACTION, [INTERACTION])).toBe(reviewer_prompt)
	})

	it('makes the interaction slot beside the code slot read only', () => {
		expect(slot_prompt(reviewer_prompt, INTERACTION, [CODE, INTERACTION])).toBe(report_prompt)
	})
})

describe('run_ship_review — re-exports the prompts', () => {
	it('keeps every prompt member under its old name', () => {
		for (const [name, member] of Object.entries(run_ship_review_prompts)) {
			expect(run_ship_review[name as keyof typeof run_ship_review]).toBe(member)
		}
	})
})
