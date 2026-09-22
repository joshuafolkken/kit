import { claude_result_event, type ClaudeResultEvent } from '#scripts/agent/claude-result-event'
import { describe, expect, it } from 'vitest'
import { lane_child_invocation } from './lane-child-invocation'
import { lane_resume } from './lane-resume'

// joshuafolkken/kit#2317: a lane re-dispatch resumes the disconnected child's session when it can and
// starts fresh otherwise. These pin both paths — the resume needs all three conditions (an Anthropic
// provider, an outage ending, a session id), and every case that misses one falls back to fresh, which
// is the exact behavior a first dispatch and a non-outage ending had before this existed.

const ISSUE = '2317'
const SESSION = '1d34ae8b-6f89-44b7-9f0f-42a67c44e650'

function outage_record(session_id: string | undefined): ClaudeResultEvent | undefined {
	return claude_result_event.decode({
		type: 'result',
		is_error: true,
		result: 'The socket connection was closed unexpectedly',
		session_id,
	})
}

function clean_record(): ClaudeResultEvent | undefined {
	return claude_result_event.decode({
		type: 'result',
		is_error: false,
		subtype: 'success',
		session_id: SESSION,
	})
}

describe('the re-dispatch resume plan (joshuafolkken/kit#2317)', () => {
	it('resumes an Anthropic outage child that left a session id', () => {
		const plan = lane_resume.plan(ISSUE, outage_record(SESSION), 'anthropic')

		expect(plan).toStrictEqual({
			kind: 'resume',
			session_id: SESSION,
			invocation: lane_child_invocation.outage_resume_invocation(ISSUE),
		})
	})

	it('starts fresh when there is no exit record to read', () => {
		expect(lane_resume.plan(ISSUE, undefined, 'anthropic').kind).toBe('fresh')
	})

	it('starts fresh when the child ended cleanly rather than on an outage', () => {
		expect(lane_resume.plan(ISSUE, clean_record(), 'anthropic').kind).toBe('fresh')
	})

	it('starts fresh when the outage record carried no session id', () => {
		expect(lane_resume.plan(ISSUE, outage_record(undefined), 'anthropic').kind).toBe('fresh')
	})

	it('starts fresh on an OpenAI lane even with an outage and a session id', () => {
		const plan = lane_resume.plan(ISSUE, outage_record(SESSION), 'openai')

		expect(plan).toStrictEqual({
			kind: 'fresh',
			invocation: lane_child_invocation.child_invocation(ISSUE),
		})
	})
})
