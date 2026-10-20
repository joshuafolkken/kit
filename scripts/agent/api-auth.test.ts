import { describe, expect, it } from 'vitest'
import { agent_exit_record } from './agent-exit-record'
import { api_auth } from './api-auth'
import { api_outage } from './api-outage'

// The exit record #4185's child wrote on 2026-10-19, trimmed to the fields the harness emitted.
const AUTH_FAILED_LINE = JSON.stringify({
	type: 'result',
	subtype: 'success',
	is_error: true,
	error: 'authentication_failed',
	result: 'Failed to authenticate: OAuth session expired and could not be refreshed',
	terminal_reason: 'api_error',
	num_turns: 1,
	session_id: 'session-4185',
})
const OUTAGE_LINE = JSON.stringify({
	type: 'result',
	is_error: true,
	result: 'API Error: Unable to connect to API (ConnectionRefused)',
})
const CLEAN_LINE = JSON.stringify({
	type: 'result',
	is_error: false,
	result: 'Failed to authenticate is what the review discussed',
})

function record_of(line: string): ReturnType<typeof agent_exit_record.read_exit_record> {
	return agent_exit_record.read_exit_record(`{"type":"system"}\n${line}\n`)
}

describe('api_auth.is_auth_failure', () => {
	it('reads the observed OAuth-expiry exit record as an authentication failure', () => {
		expect(api_auth.is_auth_failure(record_of(AUTH_FAILED_LINE))).toBe(true)
	})

	it('does not read the authentication failure as an outage', () => {
		expect(api_outage.is_outage(record_of(AUTH_FAILED_LINE))).toBe(false)
	})

	it('does not read a connection failure as an authentication failure', () => {
		expect(api_auth.is_auth_failure(record_of(OUTAGE_LINE))).toBe(false)
	})

	it('does not read a clean exit as an authentication failure however its text reads', () => {
		expect(api_auth.is_auth_failure(record_of(CLEAN_LINE))).toBe(false)
	})

	it('does not read a missing record as an authentication failure', () => {
		expect(api_auth.is_auth_failure(undefined)).toBe(false)
	})
})

describe('api_auth.is_auth_failed_transcript', () => {
	it('reads a transcript that ends on the authentication failure', () => {
		expect(api_auth.is_auth_failed_transcript(`${AUTH_FAILED_LINE}\n`)).toBe(true)
	})

	it('does not read an earlier session’s failure under a later session killed mid-turn', () => {
		const transcript = `${AUTH_FAILED_LINE}\n=== relaunch ===\n{"type":"assistant"}\n`

		expect(api_auth.is_auth_failed_transcript(transcript)).toBe(false)
	})

	it('does not read an earlier session’s failure under a later session’s non-JSON start-up error', () => {
		const transcript = `${AUTH_FAILED_LINE}\nError: unexpected start-up failure\n`

		expect(api_auth.is_auth_failed_transcript(transcript)).toBe(false)
	})
})
