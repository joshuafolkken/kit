import { describe, expect, it } from 'vitest'
import { agent_exit_record } from './agent-exit-record'
import { api_auth } from './api-auth'
import { api_outage } from './api-outage'
import { api_usage_limit } from './api-usage-limit'

// The exit record a lane child writes when the weekly limit stops it (joshuafolkken/kit#4745).
const LIMIT_TEXT = "You've hit your weekly limit · resets 10am (Asia/Tokyo)"
const NOW_MS = Date.parse('2026-10-23T16:50:00Z')
const RESET_MS = Date.parse('2026-10-24T01:00:00Z')
const RECHECKED_MS = NOW_MS + api_usage_limit.RECHECK_MS

function line_of(result: string, is_error = true): string {
	return JSON.stringify({ type: 'result', subtype: 'success', is_error, result })
}

function record_of(
	result: string,
	is_error = true,
): ReturnType<typeof agent_exit_record.read_exit_record> {
	return agent_exit_record.read_exit_record(`{"type":"system"}\n${line_of(result, is_error)}\n`)
}

const LIMIT_RECORD = record_of(LIMIT_TEXT)

describe('api_usage_limit.is_usage_limit', () => {
	it('reads the observed weekly-limit exit record as a usage limit', () => {
		expect(api_usage_limit.is_usage_limit(LIMIT_RECORD)).toBe(true)
	})

	it('reads the session limit and the older epoch form as usage limits', () => {
		const records = [
			record_of("You've hit your limit · resets 3pm (Asia/Tokyo)"),
			record_of('Claude AI usage limit reached|1793000000'),
		]

		expect(records.map((record) => api_usage_limit.is_usage_limit(record))).toEqual([true, true])
	})

	it('reads the usage limit as neither an outage nor an authentication failure', () => {
		const readings = [api_outage.is_outage(LIMIT_RECORD), api_auth.is_auth_failure(LIMIT_RECORD)]

		expect(readings).toEqual([false, false])
	})

	it('does not read a clean exit as a usage limit however its text reads', () => {
		expect(api_usage_limit.is_usage_limit(record_of(LIMIT_TEXT, false))).toBe(false)
	})

	it('does not read a connection failure as a usage limit', () => {
		const record = record_of('API Error: Unable to connect to API (ConnectionRefused)')

		expect(api_usage_limit.is_usage_limit(record)).toBe(false)
	})
})

describe('api_usage_limit.resume_ms', () => {
	it('resumes at the reset the record names', () => {
		expect(api_usage_limit.resume_ms(LIMIT_RECORD, NOW_MS)).toBe(RESET_MS)
	})

	it('re-checks on the fixed interval when the reset cannot be read', () => {
		const record = record_of("You've hit your weekly limit")

		expect(api_usage_limit.resume_ms(record, NOW_MS)).toBe(RECHECKED_MS)
	})

	it('re-checks on the fixed interval when the named reset is already past', () => {
		const record = record_of('Claude AI usage limit reached|1700000000')

		expect(api_usage_limit.resume_ms(record, NOW_MS)).toBe(RECHECKED_MS)
	})

	it('re-checks a reset passed before a late collection rather than rolling it to the next day', () => {
		const collected_ms = Date.parse('2026-10-24T01:05:00Z')
		const resumed_ms = api_usage_limit.resume_ms(LIMIT_RECORD, collected_ms, NOW_MS)

		expect(resumed_ms).toBe(collected_ms + api_usage_limit.RECHECK_MS)
	})

	it('answers undefined for a record that is no usage limit', () => {
		expect(api_usage_limit.resume_ms(record_of('done', false), NOW_MS)).toBeUndefined()
	})
})

describe('api_usage_limit.transcript_resume_ms', () => {
	it('reads a transcript that ends on the usage limit', () => {
		const transcript = `${line_of(LIMIT_TEXT)}\n`

		expect(api_usage_limit.transcript_resume_ms(transcript, NOW_MS)).toBe(RESET_MS)
	})

	it('does not read an earlier session’s limit under a later session killed mid-turn', () => {
		const transcript = `${line_of(LIMIT_TEXT)}\n=== relaunch ===\n{"type":"assistant"}\n`

		expect(api_usage_limit.transcript_resume_ms(transcript, NOW_MS)).toBeUndefined()
	})
})
