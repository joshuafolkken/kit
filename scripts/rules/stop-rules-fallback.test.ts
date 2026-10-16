import { describe, expect, it } from 'vitest'
import { stop_rules } from './stop-rules'
import { stop_rules_fixture } from './stop-rules-fixture'

const NO_REPRINT = 'do not repeat your previous reply'

// joshuafolkken/kit#3919: an action the hook could not run falls back to the refusal it replaced.
describe('stop_rules.fallback_reason', () => {
	it('falls back to the stop notification for a notify', () => {
		const decision = stop_rules_fixture.DECISION
		const reason = stop_rules.fallback_reason({
			kind: 'notify',
			issue: '7',
			message: 'm',
			decision,
		})

		expect(reason).toBe(stop_rules.STOP_NOTIFY_REASON)
	})

	it('falls back to the hold release for a release', () => {
		expect(stop_rules.fallback_reason({ kind: 'release', issue: '7' })).toBe(
			stop_rules.HOLD_RELEASE_REASON,
		)
	})

	it('names the bare numbers and the issue:cite call for a citation', () => {
		const reason = stop_rules.fallback_reason({
			kind: 'cite',
			references: ['#123', 'joshuafolkken/kit#45'],
		})

		expect(reason).toContain('#123, joshuafolkken/kit#45')
		expect(reason).toContain('pnpm josh issue:cite 123 joshuafolkken/kit#45')
		expect(reason).toContain('issue-citation.md')
	})

	// joshuafolkken/kit#2329: the fix follows the bare copy as a correction, not a reprint of the reply.
	it('asks for the correction alone, not the whole reply reissued', () => {
		const reason = stop_rules.fallback_reason({ kind: 'cite', references: ['#7'] })

		expect(reason).toContain(NO_REPRINT)
	})
})

describe('stop_rules envelopes — what the hook already did', () => {
	it('shows a notice without holding the stop', () => {
		expect(JSON.parse(stop_rules.notice_envelope('sent'))).toEqual({ systemMessage: 'sent' })
	})

	it('carries the notice alongside a refusal', () => {
		const envelope: unknown = JSON.parse(stop_rules.block_envelope('r', 'en', 'sent'))

		expect(envelope).toMatchObject({ decision: 'block', systemMessage: 'sent' })
	})

	it('leaves the notice out of a refusal that has none', () => {
		const envelope: unknown = JSON.parse(stop_rules.block_envelope('r', 'en'))

		expect(envelope).not.toHaveProperty('systemMessage')
	})
})
