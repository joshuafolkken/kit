import { describe, expect, it } from 'vitest'
import { stop_rules, type StopContext } from './stop-rules'
import { stop_rules_fixture } from './stop-rules-fixture'

const { context } = stop_rules_fixture

// joshuafolkken/kit#2422: an offer to file in an unattended run is a Tier A filing deferred to nobody.
const OFFER_MESSAGE = '起票するのが妥当だと考えます。起票してよければ言ってください。'

// The offer messages are Japanese, so they are judged in a Japanese session — the `backlogrun`
// parent's, the unattended run that still holds and notifies like an attended one.
function unattended(overrides: Partial<StopContext>): StopContext {
	return context({ session_lang: 'ja', backlog_parent: true, ...overrides })
}

function attended(overrides: Partial<StopContext>): StopContext {
	return context({ session_lang: 'ja', ...overrides })
}

describe('stop_rules.stop_outcome — filing offer in an unattended run', () => {
	it.each([
		['a dispatched lane child', { lane_child: true }],
		['a kit-launched headless agent', { headless_agent: true }],
		['the backlogrun parent', { backlog_parent: true }],
	])('blocks an offer in %s on a turn that filed nothing', (_name, role) => {
		const { reason } = stop_rules.stop_outcome(attended({ message: OFFER_MESSAGE, ...role }))

		expect(reason).toBe(stop_rules.FILING_OFFER_REASON)
	})

	it('is silent on a reply reporting a filing already made', () => {
		const message = '起票しました: [#9](https://github.com/joshuafolkken/kit/issues/9) — 所見'

		expect(stop_rules.stop_outcome(unattended({ message, filed: true })).reason).toBeUndefined()
	})

	it('is silent when a filing is on the tail even if the reply still reads as an offer', () => {
		const outcome = stop_rules.stop_outcome(unattended({ message: OFFER_MESSAGE, filed: true }))

		expect(outcome.reason).toBeUndefined()
	})

	it('is silent when the offer targets a third-party repository', () => {
		const message = `https://github.com/sveltejs/kit に${OFFER_MESSAGE}`

		expect(stop_rules.stop_outcome(unattended({ message })).reason).toBeUndefined()
	})

	it('is silent when the session owner cannot be read', () => {
		const outcome = stop_rules.stop_outcome(
			unattended({ message: OFFER_MESSAGE, session_owner: undefined }),
		)

		expect(outcome.reason).toBeUndefined()
	})
})

// joshuafolkken/kit#3538: in an interactive session the offer is the correct reply — the user confirms
// before anything is filed, so the hook no longer sends it back.
describe('stop_rules.stop_outcome — filing offer in an interactive session', () => {
	it('lets an offer to file through', () => {
		expect(stop_rules.stop_outcome(attended({ message: OFFER_MESSAGE })).reason).toBeUndefined()
	})

	it('leaves the other reply rules in place', () => {
		const { reason } = stop_rules.stop_outcome(attended({ message: `${OFFER_MESSAGE} #7` }))

		expect(reason).toContain('pnpm josh issue:cite 7')
	})
})

describe('stop_rules.stop_outcome — filing offer stands down and ordering', () => {
	it('does not block once stop_hook_active is set', () => {
		const outcome = stop_rules.stop_outcome(
			unattended({ message: OFFER_MESSAGE, stop_hook_active: true }),
		)

		expect(outcome.reason).toBeUndefined()
	})

	it('goes ahead of the citation rule and behind the hold rules', () => {
		const offer_with_bare = `${OFFER_MESSAGE} #7`
		const held = unattended({ hold_present: true, message: offer_with_bare })

		expect(stop_rules.stop_outcome(unattended({ message: offer_with_bare })).reason).toBe(
			stop_rules.FILING_OFFER_REASON,
		)
		expect(stop_rules.stop_outcome(held).reason).toBe(stop_rules.STOP_NOTIFY_REASON)
	})
})
