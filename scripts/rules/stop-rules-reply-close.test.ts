import { describe, expect, it } from 'vitest'
import { concise_reply } from './concise-reply'
import { reply_close } from './reply-close'
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

	it('asks for both the shorter reply and the close in one refusal', () => {
		const { reason } = stop_rules.stop_outcome(context({ message: LONG_REPLY }))

		expect(reason).toContain(concise_reply.REASON_OPENING)
		expect(reason).toContain(reply_close.close_note('en'))
	})
})
