import { describe, expect, it } from 'vitest'
import { claude_result_event } from './claude-result-event'

// The exit-record fields a supervisor classifies a lane child's ending from (joshuafolkken/kit#2139).

describe('exit-record fields the decoder exposes', () => {
	it('reads subtype, num_turns and the permission-denial count from a normal exit', () => {
		const event = claude_result_event.decode({
			type: 'result',
			is_error: false,
			subtype: 'success',
			num_turns: 53,
			permission_denials: [{ tool_name: 'Read' }, { tool_name: 'Read' }],
		})

		expect(event).toMatchObject({
			is_error: false,
			subtype: 'success',
			num_turns: 53,
			permission_denials: 2,
		})
	})

	// A missing or non-array `permission_denials` is zero refusals, so the classifier reads "no denials"
	// the same way whether the field was omitted or empty.
	it('counts a missing permission_denials as zero', () => {
		const event = claude_result_event.decode({
			type: 'result',
			is_error: false,
			subtype: 'success',
		})

		expect(event).toMatchObject({ permission_denials: 0, num_turns: undefined })
	})

	it('leaves subtype undefined when it is blank', () => {
		const event = claude_result_event.decode({ type: 'result', is_error: false, subtype: '  ' })

		expect(event?.subtype).toBeUndefined()
	})

	it('is undefined for anything that is not a result event', () => {
		expect(claude_result_event.decode({ type: 'assistant' })).toBeUndefined()
	})
})

// **A refused interactive ask is preserved, not just counted** (joshuafolkken/kit#2201). The question
// and options are stranded in `permission_denials`, and lifting them here is what lets `run:ending`
// put them into the park comment.
describe('the refused interactive ask the decoder lifts', () => {
	it('lifts a refused interactive ask out of the permission denials', () => {
		const event = claude_result_event.decode({
			type: 'result',
			is_error: false,
			permission_denials: [
				{
					tool_name: 'AskUserQuestion',
					tool_input: { questions: [{ question: 'Which?', options: [{ label: 'a' }] }] },
				},
			],
		})

		expect(event).toMatchObject({ permission_denials: 1, refused_ask: 'Which? [a]' })
	})

	it('leaves refused_ask undefined when no denial was an interactive ask', () => {
		const event = claude_result_event.decode({
			type: 'result',
			is_error: false,
			permission_denials: [{ tool_name: 'Read' }],
		})

		expect(event?.refused_ask).toBeUndefined()
	})
})

// **The session id an outage re-dispatch resumes from** (joshuafolkken/kit#2317). It sits on the result
// event of a `stream-json` run; without it the re-dispatch cannot resume and falls back to a fresh run.
describe('the session id the decoder exposes', () => {
	const SESSION = '1d34ae8b-6f89-44b7-9f0f-42a67c44e650'

	it('reads the session id off a result event', () => {
		const event = claude_result_event.decode({
			type: 'result',
			is_error: true,
			result: 'The socket connection was closed unexpectedly',
			session_id: SESSION,
		})

		expect(event?.session_id).toBe(SESSION)
	})

	it('leaves the session id undefined when the event carried none', () => {
		const event = claude_result_event.decode({ type: 'result', is_error: false })

		expect(event?.session_id).toBeUndefined()
	})
})
