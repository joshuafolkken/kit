import { describe, expect, it } from 'vitest'
import { stop_rules, type StopContext } from './stop-rules'

const BASE: StopContext = {
	hold_present: false,
	tree_clean: false,
	notified: false,
	message: '',
	stop_hook_active: false,
	cut_pending: false,
	filed: false,
	session_owner: 'joshuafolkken',
	headless_waiting: false,
	headless_refusals: 0,
	owes_offer: false,
	lane_child: false,
}

function context(overrides: Partial<StopContext>): StopContext {
	return { ...BASE, ...overrides }
}

// joshuafolkken/kit#2329: every stop reason ends on this, so a correction never reprints the reply.
const NO_REPRINT = 'do not repeat your previous reply'
const BARE_MESSAGE = 'done in #7'

describe('stop_rules.stop_outcome — stop notification', () => {
	it('refuses a held tree that stopped without notifying', () => {
		const { reason } = stop_rules.stop_outcome(context({ hold_present: true }))

		expect(reason).toBe(stop_rules.STOP_NOTIFY_REASON)
	})

	it('is silent when the confirmation notify is on the tail', () => {
		const outcome = stop_rules.stop_outcome(context({ hold_present: true, notified: true }))

		expect(outcome).toEqual(stop_rules.NO_OUTCOME)
	})

	it('is silent on a turn holding no hold', () => {
		expect(stop_rules.stop_outcome(context({})).reason).toBeUndefined()
	})
})

describe('stop_rules.stop_outcome — hold release', () => {
	it('refuses a clean tree that still holds', () => {
		const outcome = stop_rules.stop_outcome(
			context({ hold_present: true, tree_clean: true, notified: true }),
		)

		expect(outcome.reason).toBe(stop_rules.HOLD_RELEASE_REASON)
	})

	it('is silent when the tree is dirty (halfrun / needs-human-review)', () => {
		const outcome = stop_rules.stop_outcome(
			context({ hold_present: true, tree_clean: false, notified: true }),
		)

		expect(outcome.reason).toBeUndefined()
	})
})

describe('stop_rules.stop_outcome — loop breaker', () => {
	it('does not refuse once stop_hook_active is set', () => {
		const outcome = stop_rules.stop_outcome(
			context({ hold_present: true, tree_clean: true, stop_hook_active: true }),
		)

		expect(outcome.reason).toBeUndefined()
	})
})

describe('stop_rules.stop_outcome — pre-gate cut', () => {
	it('does not refuse a lane child ending its turn at the cut', () => {
		const outcome = stop_rules.stop_outcome(
			context({ hold_present: true, tree_clean: true, cut_pending: true }),
		)

		expect(outcome.reason).toBeUndefined()
	})
})

describe('stop_rules.stop_outcome — issue citation', () => {
	it('blocks a bare #N by naming it and the issue:cite call that fixes it', () => {
		const { reason } = stop_rules.stop_outcome(context({ message: 'done in #123 and #456' }))

		expect(reason).toContain('#123, #456')
		expect(reason).toContain('pnpm josh issue:cite 123 456')
		expect(reason).toContain('issue-citation.md')
	})

	it('carries an owner/repo#N reference through to the issue:cite argument', () => {
		const { reason } = stop_rules.stop_outcome(context({ message: 'see joshuafolkken/kit#45' }))

		expect(reason).toContain('pnpm josh issue:cite joshuafolkken/kit#45')
	})

	// joshuafolkken/kit#2329: the fix follows the bare copy as a correction, not a reprint of the whole
	// reply — reprinting is what read as a duplicate.
	it('asks for the correction alone, not the whole reply reissued', () => {
		const { reason } = stop_rules.stop_outcome(context({ message: BARE_MESSAGE }))

		expect(reason).toContain(NO_REPRINT)
	})

	it('is silent on a link-form citation', () => {
		const message = 'done in [#123](https://github.com/o/r/issues/123)'

		expect(stop_rules.stop_outcome(context({ message })).reason).toBeUndefined()
	})

	it('does not block a bare #N once stop_hook_active is set', () => {
		const outcome = stop_rules.stop_outcome(
			context({ message: BARE_MESSAGE, stop_hook_active: true }),
		)

		expect(outcome.reason).toBeUndefined()
	})

	it('lets an earlier block rule take precedence over the citation rule', () => {
		const outcome = stop_rules.stop_outcome(context({ hold_present: true, message: 'paused #7' }))

		expect(outcome.reason).toBe(stop_rules.STOP_NOTIFY_REASON)
	})
})

// joshuafolkken/kit#2422: an offer to file is a Tier A filing deferred to the user, so it blocks.
const OFFER_MESSAGE = '起票するのが妥当だと考えます。起票してよければ言ってください。'

describe('stop_rules.stop_outcome — filing offer', () => {
	it('blocks a reply that offers to file on a turn that filed nothing', () => {
		const { reason } = stop_rules.stop_outcome(context({ message: OFFER_MESSAGE }))

		expect(reason).toBe(stop_rules.FILING_OFFER_REASON)
	})

	it('is silent on a reply reporting a filing already made', () => {
		const message = '起票しました: [#9](https://github.com/joshuafolkken/kit/issues/9) — 所見'

		expect(stop_rules.stop_outcome(context({ message, filed: true })).reason).toBeUndefined()
	})

	it('is silent when a filing is on the tail even if the reply still reads as an offer', () => {
		const outcome = stop_rules.stop_outcome(context({ message: OFFER_MESSAGE, filed: true }))

		expect(outcome.reason).toBeUndefined()
	})

	it('is silent when the offer targets a third-party repository', () => {
		const message = `https://github.com/sveltejs/kit に${OFFER_MESSAGE}`

		expect(stop_rules.stop_outcome(context({ message })).reason).toBeUndefined()
	})

	it('is silent when the session owner cannot be read', () => {
		const outcome = stop_rules.stop_outcome(
			context({ message: OFFER_MESSAGE, session_owner: undefined }),
		)

		expect(outcome.reason).toBeUndefined()
	})
})

describe('stop_rules.stop_outcome — filing offer stands down and ordering', () => {
	it('does not block once stop_hook_active is set', () => {
		const outcome = stop_rules.stop_outcome(
			context({ message: OFFER_MESSAGE, stop_hook_active: true }),
		)

		expect(outcome.reason).toBeUndefined()
	})

	it('goes ahead of the citation rule and behind the hold rules', () => {
		const offer_with_bare = `${OFFER_MESSAGE} #7`

		expect(stop_rules.stop_outcome(context({ message: offer_with_bare })).reason).toBe(
			stop_rules.FILING_OFFER_REASON,
		)
		expect(
			stop_rules.stop_outcome(context({ hold_present: true, message: offer_with_bare })).reason,
		).toBe(stop_rules.STOP_NOTIFY_REASON)
	})
})

// joshuafolkken/kit#2329: all three stop reasons end on "do not repeat your previous reply" so a
// correction never reprints the reply already on screen.
describe('stop_rules reasons — the correction is a diff, not a reprint', () => {
	it.each([
		['stop notification', stop_rules.STOP_NOTIFY_REASON],
		['hold release', stop_rules.HOLD_RELEASE_REASON],
		['filing offer', stop_rules.FILING_OFFER_REASON],
	])('%s does not ask for a reprint', (_name, reason) => {
		expect(reason).toContain(NO_REPRINT)
	})
})

// joshuafolkken/kit#2437: a headless parent's turn-end kills its background waits with the process.
describe('stop_rules.stop_outcome — headless parent', () => {
	it('refuses a headless parent that would end its turn with lanes in flight', () => {
		const { reason } = stop_rules.stop_outcome(context({ headless_waiting: true }))

		expect(reason).toBe(stop_rules.HEADLESS_WAIT_REASON)
		expect(reason).toContain('lane:await')
	})

	it('is not stood down by the loop-breaker or a pending cut', () => {
		const outcome = stop_rules.stop_outcome(
			context({ headless_waiting: true, stop_hook_active: true, cut_pending: true }),
		)

		expect(outcome.reason).toBe(stop_rules.HEADLESS_WAIT_REASON)
	})

	it('lets a spinning parent stop once the refusal cap is reached', () => {
		const spinning = context({
			headless_waiting: true,
			stop_hook_active: true,
			headless_refusals: stop_rules.HEADLESS_REFUSAL_CAP,
		})

		expect(stop_rules.stop_outcome(spinning).reason).toBeUndefined()
	})

	it('counts the refusals on a transcript tail', () => {
		const tail = `a ${stop_rules.HEADLESS_WAIT_REASON} b ${stop_rules.HEADLESS_WAIT_REASON}`

		expect(stop_rules.count_headless_refusals(tail)).toBe(2)
	})

	it('resets the count at a foreground wait', () => {
		const refusal = stop_rules.HEADLESS_WAIT_REASON
		const tail = `${refusal} ${refusal} {"command":"pnpm josh lane:await 12"} ${refusal}`

		expect(stop_rules.count_headless_refusals(tail)).toBe(1)
	})

	it('lets a parent with nothing to wait on stop', () => {
		expect(stop_rules.stop_outcome(context({ headless_waiting: false })).reason).toBeUndefined()
	})
})

// joshuafolkken/kit#2445: a lane child stopped to ask a person for `git add` on a tree the
// sanctioned commit flow could already finish.
const INDEX_REQUEST =
	'The conflict is resolved; please grant permission to run `git add` on the file.'

describe('stop_rules.stop_outcome — lane index permission', () => {
	it('refuses a lane child that stops asking for index permission', () => {
		const { reason } = stop_rules.stop_outcome(
			context({ lane_child: true, message: INDEX_REQUEST }),
		)

		expect(reason).toBe(stop_rules.LANE_INDEX_REASON)
		expect(reason).toContain('pnpm josh git -y')
		expect(reason).toContain(NO_REPRINT)
	})

	it('goes ahead of the stop notification a held lane would owe', () => {
		const held = context({ lane_child: true, hold_present: true, message: INDEX_REQUEST })

		expect(stop_rules.stop_outcome(held).reason).toBe(stop_rules.LANE_INDEX_REASON)
	})

	it('asks the same in Japanese', () => {
		const message = '`git add` の許可をください'

		expect(stop_rules.stop_outcome(context({ lane_child: true, message })).reason).toBe(
			stop_rules.LANE_INDEX_REASON,
		)
	})

	it('stays silent outside a lane child', () => {
		expect(stop_rules.stop_outcome(context({ message: INDEX_REQUEST })).reason).toBeUndefined()
	})

	it('stays silent on a report that only names the command', () => {
		const message = 'Committed through `pnpm josh git -y`, which ran `git add` itself.'

		expect(stop_rules.stop_outcome(context({ lane_child: true, message })).reason).toBeUndefined()
	})

	it('honours the loop-breaker', () => {
		const repeated = context({ lane_child: true, message: INDEX_REQUEST, stop_hook_active: true })

		expect(stop_rules.stop_outcome(repeated).reason).toBeUndefined()
	})
})

describe('stop_rules.stop_outcome — backlog pick-up (joshuafolkken/kit#2452)', () => {
	it('refuses a parent turn that owes the pick-up ask', () => {
		const { reason } = stop_rules.stop_outcome(context({ owes_offer: true }))

		expect(reason).toBe(stop_rules.PICKUP_REASON)
		expect(reason).toContain(NO_REPRINT)
	})

	it('lets a turn that owes nothing stop', () => {
		expect(stop_rules.stop_outcome(context({ owes_offer: false })).reason).toBeUndefined()
	})

	it('reports the stop notification ahead of the pick-up', () => {
		const held = context({ owes_offer: true, hold_present: true })

		expect(stop_rules.stop_outcome(held).reason).toBe(stop_rules.STOP_NOTIFY_REASON)
	})

	it('stands down on the loop-breaker', () => {
		const looped = context({ owes_offer: true, stop_hook_active: true })

		expect(stop_rules.stop_outcome(looped).reason).toBeUndefined()
	})
})

describe('stop_rules envelopes and payload', () => {
	it('blocks with a decision envelope', () => {
		expect(JSON.parse(stop_rules.block_envelope('r'))).toEqual({ decision: 'block', reason: 'r' })
	})

	it('parses a valid Stop payload and rejects a malformed one', () => {
		expect(stop_rules.parse_stop_payload('{"transcript_path":"/t"}')?.transcript_path).toBe('/t')
		expect(stop_rules.parse_stop_payload('{}')).toBeUndefined()
	})
})
