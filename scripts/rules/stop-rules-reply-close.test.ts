import { describe, expect, it } from 'vitest'
import { concise_reply } from './concise-reply'
import { reply_close } from './reply-close'
import { stop_decision } from './stop-decision'
import { stop_rules } from './stop-rules'
import { stop_rules_fixture } from './stop-rules-fixture'

const { prose_context: context } = stop_rules_fixture

const OPEN_REPLY = 'The gate passed and the pull request is open.'
const LONG_REPLY = 'The gate passed and the pull request is open. '.repeat(20)

// joshuafolkken/kit#8299: a reply with no close line is sent back once.
describe('stop_rules.stop_outcome — reply close', () => {
	it('sends back a reply with no close line', () => {
		const { reason } = stop_rules.stop_outcome(context({ message: OPEN_REPLY }))

		expect(reason).toContain(reply_close.REASON_OPENING)
	})

	it('sends a reply back only once — the loop-breaker lets the rewrite stop', () => {
		const looped = context({ message: OPEN_REPLY, stop_hook_active: true })

		expect(stop_rules.stop_outcome(looped).reason).toBeUndefined()
	})

	it('stands down in a headless session, whose reply has no reader', () => {
		const headless = context({ message: OPEN_REPLY, headless_agent: true })

		expect(stop_rules.stop_outcome(headless).reason).toBeUndefined()
	})

	it.each([
		['a lane child', { lane_child: true }],
		['the backlogrun parent', { backlog_parent: true }],
	])('stands down in %s, an unattended session', (_name, unattended) => {
		const outcome = stop_rules.stop_outcome(context({ message: OPEN_REPLY, ...unattended }))

		expect(outcome.reason ?? '').not.toContain(reply_close.REASON_OPENING)
	})

	it('leaves a held stop with no decision to the decision refusal', () => {
		const { reason } = stop_rules.stop_outcome(context({ hold_issue: '7', message: OPEN_REPLY }))

		expect(reason).toBe(stop_decision.DECISION_REASON)
	})

	it('asks for the close in a language refusal too', () => {
		const drifted = context({ message: OPEN_REPLY, session_lang: 'ja' })
		const expected = `${stop_rules.build_language_reason('ja')}${reply_close.close_note('ja')}`

		expect(stop_rules.stop_outcome(drifted).reason).toBe(expected)
	})

	it('asks for both the shorter reply and the close in one refusal', () => {
		const { reason } = stop_rules.stop_outcome(context({ message: LONG_REPLY }))

		expect(reason).toContain(concise_reply.REASON_OPENING)
		expect(reason).toContain(reply_close.close_note('en'))
	})
})
