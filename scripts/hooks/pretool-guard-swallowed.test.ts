import { hook_decision } from '#scripts/josh/hook-decision'
import { error_text } from '#scripts/lib/error-message'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pretool_outcome } from './pretool-guard'

// joshuafolkken/kit#9054: a payload the guard could not read is recorded, not silent — the call is
// still let through (fail-open).

afterEach(() => {
	vi.restoreAllMocks()
})

describe('pretool_outcome — a payload that cannot be read', () => {
	it('lets the call through and records the failure', () => {
		const trace = vi.spyOn(error_text, 'trace_swallowed').mockReturnValue(undefined)

		vi.spyOn(hook_decision, 'parse_hook_payload').mockImplementation(() => {
			throw new Error('unreadable payload')
		})

		expect(() => pretool_outcome('{}')).not.toThrow()
		expect(trace).toHaveBeenCalledWith('pretool_guard.guarded_call', expect.any(Error))
	})
})
