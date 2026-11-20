import { describe, expect, it } from 'vitest'
import { deferral_owner } from './deferral-owner'
import { stop_rules, type StopContext } from './stop-rules'
import { stop_rules_fixture } from './stop-rules-fixture'

const { context } = stop_rules_fixture

// joshuafolkken/kit#8296: a reply that defers a decision or a filing names its owner in every session.
const DEFERRAL_MESSAGE = '原因が見えたら、その時に起票すれば足りる。'

function japanese(overrides: Partial<StopContext>): StopContext {
	return context({ session_lang: 'ja', message: DEFERRAL_MESSAGE, ...overrides })
}

describe('stop_rules.stop_outcome — unowned deferral', () => {
	it.each([
		['an interactive consultation session', {}],
		['a dispatched lane child', { lane_child: true }],
		['a kit-launched headless agent', { headless_agent: true }],
	])('blocks the stop in %s', (_name, role) => {
		expect(stop_rules.stop_outcome(japanese(role)).reason).toBe(deferral_owner.REASON)
	})

	it('is silent once the paragraph names the owning Issue', () => {
		const outcome = stop_rules.stop_outcome(japanese({ message: `${DEFERRAL_MESSAGE} #8300` }))

		expect(outcome.reason).toBeUndefined()
	})

	it('is silent past the loop-breaker', () => {
		expect(stop_rules.stop_outcome(japanese({ stop_hook_active: true })).reason).toBeUndefined()
	})
})
