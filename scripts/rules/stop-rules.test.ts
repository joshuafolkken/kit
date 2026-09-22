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

// joshuafolkken/kit#2329: all three stop reasons end on "do not repeat your previous reply" so a
// correction never reprints the reply already on screen.
describe('stop_rules reasons — the correction is a diff, not a reprint', () => {
	it.each([
		['stop notification', stop_rules.STOP_NOTIFY_REASON],
		['hold release', stop_rules.HOLD_RELEASE_REASON],
	])('%s does not ask for a reprint', (_name, reason) => {
		expect(reason).toContain(NO_REPRINT)
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
