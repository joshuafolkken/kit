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
