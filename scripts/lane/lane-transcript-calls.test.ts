import { describe, expect, it } from 'vitest'
import { lane_transcript_calls } from './lane-transcript-calls'

// joshuafolkken/kit#4418: a transcript's `tool_use` lines join their `tool_result` lines by id, a
// foreground call is timed by the gap between the two, and a backgrounded call is kept untimed.

const SESSION = 'session-a'
const LANE = '/projects/kit-lanes-1'
const SOURCE = { session_id: SESSION, lane: LANE }
const START = '2026-10-21T10:00:00.000Z'
const END = '2026-10-21T10:00:07.500Z'
const SEVEN_AND_A_HALF_SECONDS = 7500

function use_line(id: string, input: Record<string, unknown>, at = START): string {
	const block = { type: 'tool_use', id, name: 'Bash', input }

	return JSON.stringify({ type: 'assistant', timestamp: at, message: { content: [block] } })
}

function result_line(id: string, content: unknown, at = END): string {
	const block = { type: 'tool_result', tool_use_id: id, content }

	return JSON.stringify({ type: 'user', timestamp: at, message: { content: [block] } })
}

describe('lane_transcript_calls.parse — timing', () => {
	it('times a foreground call as the gap from its use line to its result line', () => {
		const command = 'pnpm josh lint:related'
		const raw = [use_line('a', { command }), result_line('a', 'ok')]

		expect(lane_transcript_calls.parse(SOURCE, raw.join('\n'))).toStrictEqual([
			{
				session_id: SESSION,
				lane: LANE,
				started_ms: Date.parse(START),
				duration_ms: SEVEN_AND_A_HALF_SECONDS,
				tool: 'Bash',
				background: false,
				command,
				subagent: undefined,
				output: 'ok',
			},
		])
	})

	it('keeps a backgrounded call but leaves it untimed', () => {
		const input = { command: 'pnpm josh gate', run_in_background: true }
		const raw = [use_line('b', input), result_line('b', 'running in background')].join('\n')
		const [call] = lane_transcript_calls.parse(SOURCE, raw)

		expect(call?.background).toBe(true)
		expect(call?.duration_ms).toBeUndefined()
	})

	it('leaves a call whose result never arrived untimed', () => {
		const [call] = lane_transcript_calls.parse(SOURCE, use_line('c', { command: 'ls' }))

		expect(call?.duration_ms).toBeUndefined()
		expect(call?.output).toBe('')
	})
})

// joshuafolkken/kit#4630: `lane:value edit` times the edits apart from the shell calls.
describe('lane_transcript_calls.parse — tool name', () => {
	it('keeps the name of the tool each call used', () => {
		const block = { type: 'tool_use', id: 'f', name: 'Edit', input: { file_path: 'a.ts' } }
		const use = JSON.stringify({ timestamp: START, message: { content: [block] } })
		const [call] = lane_transcript_calls.parse(SOURCE, [use, result_line('f', 'ok')].join('\n'))

		expect(call?.tool).toBe('Edit')
		expect(call?.duration_ms).toBe(SEVEN_AND_A_HALF_SECONDS)
	})
})

function agent_call(name: string, input: Record<string, unknown>): string {
	const block = { type: 'tool_use', id: 'g', name, input }

	return JSON.stringify({ timestamp: START, message: { content: [block] } })
}

// A prompt that is not a review brief: no level, not the interaction review (joshuafolkken/kit#5539).
const NO_BRIEF = { level: undefined, pass: undefined }

// joshuafolkken/kit#5297: the implement's subagent time splits by the agent each call dispatched.
describe('lane_transcript_calls.parse — subagent', () => {
	it('keeps the agent type and model an Agent or Task call names', () => {
		const input = { subagent_type: 'investigator', model: 'sonnet', prompt: 'p' }
		const [agent] = lane_transcript_calls.parse(SOURCE, agent_call('Agent', input))
		const [task] = lane_transcript_calls.parse(SOURCE, agent_call('Task', input))

		const expected = { type: 'investigator', model: 'sonnet', ...NO_BRIEF }

		expect(agent?.subagent).toStrictEqual(expected)
		expect(task?.subagent).toStrictEqual(expected)
	})

	it('reads an Agent call naming no type as general-purpose, its model unnamed', () => {
		const [call] = lane_transcript_calls.parse(SOURCE, agent_call('Agent', { model: '' }))

		expect(call?.subagent).toStrictEqual({ type: 'general-purpose', model: undefined, ...NO_BRIEF })
	})

	it('gives a call of any other tool no subagent', () => {
		const input = { subagent_type: 'investigator', command: 'ls' }
		const [call] = lane_transcript_calls.parse(SOURCE, agent_call('Bash', input))

		expect(call?.subagent).toBeUndefined()
	})
})

describe('lane_transcript_calls.parse — tolerance', () => {
	it('joins the text parts of a block-list result', () => {
		const parts = [{ type: 'text', text: 'one' }, { type: 'image' }, { type: 'text', text: 'two' }]
		const raw = [use_line('d', {}), result_line('d', parts)].join('\n')
		const [call] = lane_transcript_calls.parse(SOURCE, raw)

		expect(call?.output).toBe('one\n\ntwo')
		expect(call?.command).toBeUndefined()
	})

	it('skips a malformed line, a line without a timestamp and a non-message line', () => {
		const raw = [
			'{not json',
			JSON.stringify({ type: 'assistant', message: { content: [] } }),
			JSON.stringify({ type: 'queue-operation', timestamp: START }),
			use_line('e', { command: 'ls' }),
			result_line('e', 'listed'),
		].join('\n')

		expect(lane_transcript_calls.parse(SOURCE, raw)).toHaveLength(1)
	})
})
