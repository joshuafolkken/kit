import { describe, expect, it } from 'vitest'
import { backlog_hold_codes } from './backlog-hold-codes'

// joshuafolkken/kit#7287: `lane:stats` and the gap readers key on these ledger strings, so moving them
// here must not change one.
describe('backlog_hold_codes — the ledger hold codes', () => {
	it('keeps the codes the ledger already records', () => {
		expect(backlog_hold_codes).toStrictEqual({
			DRAINED_REASON: 'drained',
			DRIVERLESS_PREFIX: 'driverless:',
			HAND_BACK_PREFIX: 'hand-back',
			MEMORY_REASON: 'memory',
			OFFER_PREFIX: 'offer',
			REASON_SEPARATOR: ':',
			USAGE_LIMIT_REASON: 'usage-limit',
			WATCH_VERDICT: 'watch',
		})
	})
})
