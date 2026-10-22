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

describe('whether the transcript ends on its exit record', () => {
	it('reads a transcript whose last line is its result event', () => {
		const transcript = `${lines({ type: 'system' }, { type: 'result', is_error: true })}\n`

		expect(agent_exit_record.ends_on_exit_record(transcript)).toBe(true)
	})

	it('does not read a result followed by a later launch’s non-JSON error', () => {
		const transcript = `${lines({ type: 'result', is_error: true })}\nError: unexpected start-up failure`

		expect(agent_exit_record.ends_on_exit_record(transcript)).toBe(false)
	})

	it('does not read an empty transcript', () => {
		expect(agent_exit_record.ends_on_exit_record('')).toBe(false)
	})
})

describe('whether the session was killed inside a turn', () => {
	it('reads a session that a background task woke after its result, then lost, as mid-turn', () => {
		const transcript = lines(
			{ type: 'result', is_error: false, subtype: 'success' },
			{ type: 'system', subtype: 'task_notification' },
			{ type: 'user', message: {} },
		)

		expect(agent_exit_record.is_mid_turn(transcript)).toBe(true)
	})

	it('reads a session that never finished its first turn as mid-turn', () => {
		expect(agent_exit_record.is_mid_turn(lines({ type: 'system', subtype: 'init' }))).toBe(true)
	})

	it('does not read a session whose last event is its result as mid-turn', () => {
		const transcript = [
			JSON.stringify({ type: 'assistant', message: {} }),
			JSON.stringify({ type: 'result', is_error: false }),
			'trailing stderr text',
		].join('\n')

		expect(agent_exit_record.is_mid_turn(transcript)).toBe(false)
	})

	it('does not read a Codex transcript, which never writes a result, as mid-turn', () => {
		const transcript = lines({ type: 'thread.started' }, { type: 'turn.failed', error: {} })

		expect(agent_exit_record.is_mid_turn(transcript)).toBe(false)
	})

	it('does not read an empty transcript as mid-turn', () => {
		expect(agent_exit_record.is_mid_turn('')).toBe(false)
	})
})
