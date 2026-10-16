import { describe, expect, it } from 'vitest'
import { stop_decision } from './stop-decision'
import { stop_rules } from './stop-rules'
import { stop_rules_fixture } from './stop-rules-fixture'

const { DECISION_MESSAGE, action_kinds, context } = stop_rules_fixture

const HELD = { hold_issue: '3919', message: DECISION_MESSAGE }

// joshuafolkken/kit#3961: the four confirmations that waited on nobody, and the one that does.
describe('stop_rules.stop_outcome — a confirmation only for a decision', () => {
	it('sends none at a token-limit cut handed to a successor (phenomenon 1)', () => {
		expect(stop_rules.stop_outcome(context({ ...HELD, cut_pending: true }))).toEqual(
			stop_rules.NO_OUTCOME,
		)
	})

	it('sends none a second time once the pause is recorded as notified (phenomenon 2)', () => {
		expect(stop_rules.stop_outcome(context({ ...HELD, notified: true }))).toEqual(
			stop_rules.NO_OUTCOME,
		)
	})

	it('neither notifies nor releases another run’s hold at a kickoff stop (phenomenon 3)', () => {
		const kickoff = context({ ...HELD, hold_issue: '3956', hold_owned: false, tree_clean: true })

		expect(stop_rules.stop_outcome(kickoff)).toEqual(stop_rules.NO_OUTCOME)
	})

	it('sends none when the reply answers the person’s question (phenomenon 4)', () => {
		const answer = context({ ...HELD, hold_issue: '3902', answers_question: true })

		expect(stop_rules.stop_outcome(answer)).toEqual(stop_rules.NO_OUTCOME)
	})

	it('sends the reply’s own recommended and alternative choices for a decision stop', () => {
		const message = 'Tier B: two shapes.\nRecommended: split the module\nAlternative: keep one file'
		const { actions } = stop_rules.stop_outcome(context({ hold_issue: '7', message }))
		const decision = { recommended: 'split the module', alternative: 'keep one file' }

		expect(actions).toEqual([{ kind: 'notify', issue: '7', message, decision }])
	})
})

describe('stop_rules.stop_outcome — a held stop with no decision line', () => {
	it('sends the stop back once rather than announcing it', () => {
		const outcome = stop_rules.stop_outcome(context({ hold_issue: '7', message: 'paused' }))

		expect(outcome.reason).toBe(stop_decision.DECISION_REASON)
		expect(outcome.actions).toEqual([])
	})

	it('joins the decision to a language refusal so one continuation answers both', () => {
		const message = 'The gate passed and the pull request is open.'
		const held = context({ hold_issue: '7', message, session_lang: 'ja' })
		const { reason } = stop_rules.stop_outcome(held)

		expect(reason).toContain(stop_rules.build_language_reason('ja'))
		expect(reason).toContain(stop_decision.DECISION_REASON)
	})

	it('sends nothing past the loop-breaker', () => {
		const held = { hold_issue: '7', message: 'nothing awaited', stop_hook_active: true }

		expect(action_kinds(held)).toEqual([])
	})

	it('still releases a clean tree past the loop-breaker', () => {
		const held = { hold_issue: '7', tree_clean: true, stop_hook_active: true }

		expect(action_kinds(held)).toEqual(['release'])
	})
})
