import { describe, expect, it } from 'vitest'
import { agent_exit_record } from './agent-exit-record'

function lines(...events: ReadonlyArray<unknown>): string {
	return events.map((event) => JSON.stringify(event)).join('\n')
}

describe('reading the exit record from a transcript', () => {
	it('returns the terminal result event and its fields', () => {
		const transcript = lines(
			{ type: 'system', subtype: 'init' },
			{ type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } },
			{
				type: 'result',
				is_error: false,
				subtype: 'success',
				num_turns: 12,
				permission_denials: [],
			},
		)

		expect(agent_exit_record.read_exit_record(transcript)).toMatchObject({
			is_error: false,
			subtype: 'success',
			num_turns: 12,
			permission_denials: 0,
		})
	})

	// A resumed session appends its own result line; the last one is the ending that matters.
	it('takes the last result event when a transcript carries more than one', () => {
		const transcript = lines(
			{ type: 'result', is_error: true, subtype: 'error_max_turns', num_turns: 1 },
			{ type: 'result', is_error: false, subtype: 'success', num_turns: 40 },
		)

		expect(agent_exit_record.read_exit_record(transcript)).toMatchObject({
			subtype: 'success',
			num_turns: 40,
		})
	})
})

describe('a transcript the exit record cannot be read from', () => {
	it('is undefined for a transcript with no result event', () => {
		const transcript = lines(
			{ type: 'system', subtype: 'init' },
			{ type: 'assistant', message: {} },
		)

		expect(agent_exit_record.read_exit_record(transcript)).toBeUndefined()
	})

	it('passes over lines that are not JSON', () => {
		const transcript = ['not json', JSON.stringify({ type: 'result', is_error: false })].join('\n')

		expect(agent_exit_record.read_exit_record(transcript)).toMatchObject({ is_error: false })
	})
})
