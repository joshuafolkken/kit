import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { guard_remedy } from './guard-remedy'
import { reviewer_foreground } from './reviewer-foreground'

// joshuafolkken/kit#5154: a lane child's turn end kills a background `reviewer`, so the row runs that
// dispatch with `run_in_background: false`. **Both directions matter**: a row silent on the background
// launch leaves the poll-and-join wait where it was, and one that speaks outside a lane, on a foreground
// dispatch or on another agent type rewrites a call that already did the right thing.

const PROMPT = 'Review the diff in the brief'
const REVIEWER = 'reviewer'
const VERIFICATION = 'reviewer-verification'

function agent_call(
	input: Record<string, unknown>,
	name = 'Agent',
): { name: string; input: Record<string, unknown> } {
	return { name, input: { prompt: PROMPT, ...input } }
}

describe('reviewer_foreground.is_background_reviewer — the lane child', () => {
	it.each([
		[
			'a `reviewer` launched in the background',
			agent_call({ subagent_type: REVIEWER, run_in_background: true }),
		],
		['a `reviewer-verification` with no field', agent_call({ subagent_type: VERIFICATION })],
		['the consumer spelling', agent_call({ subagent_type: 'kit:reviewer' })],
		['the published `Task` spelling', agent_call({ subagent_type: REVIEWER }, 'Task')],
	])('fires on %s', (_case, call) => {
		expect(reviewer_foreground.is_background_reviewer(call, true)).toBe(true)
	})

	it.each([
		[
			'a `reviewer` in the foreground',
			agent_call({ subagent_type: REVIEWER, run_in_background: false }),
		],
		['an `investigator`', agent_call({ subagent_type: 'investigator' })],
		['a type that only contains the name', agent_call({ subagent_type: 'reviewer-x' })],
		['a call of another tool', { name: 'Bash', input: { command: 'ls' } }],
	])('lets %s through', (_case, call) => {
		expect(reviewer_foreground.is_background_reviewer(call, true)).toBe(false)
	})

	it('lets a background `reviewer` through outside a lane', () => {
		const call = agent_call({ subagent_type: REVIEWER, run_in_background: true })

		expect(reviewer_foreground.is_background_reviewer(call, false)).toBe(false)
	})
})

describe('reviewer_foreground.ROW — delivered by the rule guard', () => {
	it('is a rewrite row the guard delivers', () => {
		const ids = delivered_rules.DELIVERED_RULES.map((rule) => rule.id)

		expect(ids).toContain(reviewer_foreground.ROW.id)
		expect(guard_remedy.is_rewrite(reviewer_foreground.ROW.id)).toBe(true)
	})

	it('refuses every occurrence the rewrite cannot reach', () => {
		expect(reviewer_foreground.ROW.decide()).toBe(true)
	})

	it('scores a foreground dispatch as kept and reaches every reviewer dispatch', () => {
		const kept = agent_call({ subagent_type: REVIEWER, run_in_background: false })
		const missed = agent_call({ subagent_type: VERIFICATION })

		expect(reviewer_foreground.ROW.keeps(kept)).toBe(true)
		expect(reviewer_foreground.ROW.keeps(missed)).toBe(false)
		expect(reviewer_foreground.ROW.reaches(missed)).toBe(true)
	})

	it('points the note and the refusal at the chain-rule step', () => {
		expect(reviewer_foreground.REVIEWER_FOREGROUND_NOTE).toContain('chain-rule.md')
		expect(reviewer_foreground.REVIEWER_FOREGROUND_REASON).toContain('`run_in_background: false`')
	})

	it('rewrites a lane child’s background reviewer with the field, and nothing else', () => {
		const call = agent_call({ subagent_type: REVIEWER, run_in_background: true })
		const foreground = agent_call({ subagent_type: REVIEWER, run_in_background: false })

		expect(reviewer_foreground.foreground_input(call, true)).toEqual(foreground.input)
		expect(reviewer_foreground.foreground_input(call, false)).toBeUndefined()
		expect(reviewer_foreground.foreground_input(foreground, true)).toBeUndefined()
	})
})
