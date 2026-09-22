import { describe, expect, it } from 'vitest'
import { api_outage } from './api-outage'
import type { ClaudeResultEvent } from './claude-result-event'

// joshuafolkken/kit#2240: a dispatched lane child that dies because it could not reach the API must be
// told apart from one that stopped mid-implementation on its own. The distinction is read mechanically
// off the exit record — the error flag plus a fixed transport-failure signature — never from prose.

const CONNECTION_REFUSED = 'Unable to connect to API (ConnectionRefused)'
const CONNECTION_MARKER = 'unable to connect to api'

function record(over: Partial<ClaudeResultEvent> = {}): ClaudeResultEvent {
	return {
		is_error: true,
		subtype: 'success',
		num_turns: 19,
		permission_denials: 0,
		refused_ask: undefined,
		reason: undefined,
		session_id: undefined,
		usage: undefined,
		...over,
	}
}

describe('api_outage.is_outage', () => {
	// Each of the transport-failure signatures the two observed outages surfaced as, matched regardless
	// of case — all read as an outage.
	it.each([
		CONNECTION_REFUSED,
		'The socket connection was closed unexpectedly',
		'ECONNREFUSED :443',
	])('reads a transport-failure exit as an outage: %s', (reason) => {
		expect(api_outage.is_outage(record({ reason }))).toBe(true)
	})

	// A child that ended in error for a reason that is not a transport failure is not an outage — the
	// marker set is transport signatures alone, not any error.
	it('does not read an unrelated error as an outage', () => {
		expect(api_outage.is_outage(record({ reason: 'Refactoring rule not satisfied' }))).toBe(false)
	})

	// The error flag is required: a turn that ended cleanly is never an outage however its text reads.
	it('does not read a clean exit as an outage even when the reason carries a marker', () => {
		expect(api_outage.is_outage(record({ is_error: false, reason: CONNECTION_MARKER }))).toBe(false)
	})

	it('is not an outage when there is no reason text', () => {
		expect(api_outage.is_outage(record({ reason: undefined }))).toBe(false)
	})

	it('is not an outage when the exit record could not be read', () => {
		expect(api_outage.is_outage(undefined)).toBe(false)
	})
})

describe('api_outage.outage_marker', () => {
	it('names the marker an outage matched', () => {
		expect(api_outage.outage_marker(record({ reason: CONNECTION_REFUSED }))).toBe(CONNECTION_MARKER)
	})

	it('is undefined for a non-outage', () => {
		expect(api_outage.outage_marker(record({ reason: 'ordinary stop' }))).toBeUndefined()
	})
})
