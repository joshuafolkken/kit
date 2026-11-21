import { describe, expect, it } from 'vitest'
import { agent_usage_limit } from './agent-usage-limit'

describe('structured usage rejection', () => {
	it.each([
		{ type: 'assistant', error: 'rate_limit' },
		{ type: 'error', error: { code: 'rate_limit_error' } },
		{ type: 'error', error: { type: 'usage_limit_reached' } },
		{ type: 'error', error: { status: 429 } },
		{ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } },
	])('accepts a structured rejection %j (ac-8524160c)', (event) => {
		expect(agent_usage_limit.is_rejected(event)).toBe(true)
	})

	it.each([
		undefined,
		{ type: 'error', error: { message: 'usage_limit_reached' } },
		{ type: 'assistant', error: 'authentication_error' },
		{ type: 'result', error: 'rate_limit' },
		{ type: 'error', error: { status: '429' } },
		{ type: 'rate_limit_event', rate_limit_info: 'malformed' },
		{ type: 'rate_limit_event', rate_limit_info: { overageStatus: 'rejected' } },
	])('rejects unconfirmed usage limits %j', (event) => {
		expect(agent_usage_limit.is_rejected(event)).toBe(false)
	})
})
