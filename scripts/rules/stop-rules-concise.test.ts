import { describe, expect, it } from 'vitest'
import { concise_reply } from './concise-reply'
import { stop_rules } from './stop-rules'
import { stop_rules_fixture } from './stop-rules-fixture'

const { context } = stop_rules_fixture

const LONG_REPLY = 'The gate passed and the pull request is open. '.repeat(20)

// joshuafolkken/kit#5328: a reply whose narrative runs over the limit is sent back once.
describe('stop_rules.stop_outcome — concise reply', () => {
	it('sends back a reply over the limit, naming the section', () => {
		const { reason } = stop_rules.stop_outcome(context({ message: LONG_REPLY }))

		expect(reason).toContain(concise_reply.REASON_OPENING)
		expect(reason).toContain('"concise-reply"')
	})

	it('lets a reply over the limit stop when the prompt asked for the detail', () => {
		const asked = context({ message: LONG_REPLY, prompt: '具体的に教えて' })

		expect(stop_rules.stop_outcome(asked).reason).toBeUndefined()
	})

	it('sends a reply back only once — the loop-breaker lets the rewrite stop', () => {
		const looped = context({ message: LONG_REPLY, stop_hook_active: true })

		expect(stop_rules.stop_outcome(looped).reason).toBeUndefined()
	})

	it('stands down in a headless session, whose reply has no reader', () => {
		const headless = context({ message: LONG_REPLY, headless_agent: true })

		expect(stop_rules.stop_outcome(headless).reason).toBeUndefined()
	})

	it('sends back a drifted reply for its language first', () => {
		const drifted = context({ message: LONG_REPLY, session_lang: 'ja' })

		expect(stop_rules.stop_outcome(drifted).reason).toBe(stop_rules.build_language_reason('ja'))
	})
})
