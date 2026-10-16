import { describe, expect, it } from 'vitest'
import { stop_rules } from './stop-rules'
import { stop_rules_fixture } from './stop-rules-fixture'

const { action_kinds, context } = stop_rules_fixture

const BARE_CITATION = 'done in #7'
const ENGLISH_REPLY = 'The gate passed and the pull request is open.'

// Each kit-launched path carries the headless mark; what tells them apart is the rest of the context.
const HEADLESS_PATHS = [
	['lane child', { headless_agent: true, lane_child: true }],
	['ship reviewer', { headless_agent: true }],
	['woken run:wake session', { headless_agent: true, headless_waiting: false }],
] as const

// joshuafolkken/kit#3245: a headless agent's reply lands in a stream-json log nobody reads.
describe('stop_rules.stop_outcome — reply wording in a headless agent', () => {
	it.each(HEADLESS_PATHS)('does not cite a bare #N from a %s', (_path, marks) => {
		const outcome = stop_rules.stop_outcome(context({ ...marks, message: BARE_CITATION }))

		expect(outcome).toEqual(stop_rules.NO_OUTCOME)
	})

	it.each(HEADLESS_PATHS)('does not send back a %s reply in another language', (_path, marks) => {
		const drifted = context({ ...marks, session_lang: 'ja', message: ENGLISH_REPLY })

		expect(stop_rules.stop_outcome(drifted).reason).toBeUndefined()
	})

	it('still applies both in an interactive session', () => {
		const drifted = context({ session_lang: 'ja', message: ENGLISH_REPLY })

		expect(action_kinds({ message: BARE_CITATION })).toEqual(['cite'])
		expect(stop_rules.stop_outcome(drifted).reason).toBe(stop_rules.build_language_reason('ja'))
	})

	it('keeps the mid-workflow stop notification for a headless agent', () => {
		const held = { headless_agent: true, hold_issue: '7', message: BARE_CITATION }

		expect(action_kinds(held)).toEqual(['notify'])
	})
})
