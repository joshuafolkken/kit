import { describe, expect, it } from 'vitest'
import { stop_rules, type StopContext } from './stop-rules'

const BASE: StopContext = {
	hold_present: false,
	tree_clean: false,
	notified: false,
	message: '',
	stop_hook_active: false,
	cut_pending: false,
}

function context(overrides: Partial<StopContext>): StopContext {
	return { ...BASE, ...overrides }
}

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
	it('notices a bare #N in the reply', () => {
		expect(stop_rules.stop_outcome(context({ message: 'done in #123' })).notice).toBe(
			stop_rules.ISSUE_CITATION_NOTICE,
		)
	})

	it('is silent on a link-form citation', () => {
		const message = 'done in [#123](https://github.com/o/r/issues/123)'

		expect(stop_rules.stop_outcome(context({ message })).notice).toBeUndefined()
	})

	it('lets a block take precedence over a notice', () => {
		const outcome = stop_rules.stop_outcome(context({ hold_present: true, message: 'paused #7' }))

		expect(outcome.reason).toBe(stop_rules.STOP_NOTIFY_REASON)
		expect(outcome.notice).toBeUndefined()
	})
})

describe('stop_rules envelopes and payload', () => {
	it('blocks with a decision envelope', () => {
		expect(JSON.parse(stop_rules.block_envelope('r'))).toEqual({ decision: 'block', reason: 'r' })
	})

	it('notices with a systemMessage envelope', () => {
		expect(JSON.parse(stop_rules.notice_envelope('n'))).toEqual({ systemMessage: 'n' })
	})

	it('parses a valid Stop payload and rejects a malformed one', () => {
		expect(stop_rules.parse_stop_payload('{"transcript_path":"/t"}')?.transcript_path).toBe('/t')
		expect(stop_rules.parse_stop_payload('{}')).toBeUndefined()
	})
})
