import { describe, expect, it } from 'vitest'
import { agent_event } from './agent-event'

const TURN_COMPLETED = 'turn.completed'
const TURN_FAILED = 'turn.failed'
const BUDGET_EXCEEDED = 'budget exceeded'
const CHECKING_GATE = 'checking gate'
const THREAD_STARTED = 'thread.started'

function lines(...events: ReadonlyArray<unknown>): string {
	return events.map((event) => JSON.stringify(event)).join('\n')
}

describe('Claude event normalization', () => {
	it('normalizes Claude launch, progress and success', () => {
		const transcript = lines(
			{ type: 'system', subtype: 'init' },
			{ type: 'assistant', message: { content: [{ type: 'text', text: 'working' }] } },
			{ type: 'result', is_error: false, result: 'done' },
		)

		expect(agent_event.read(transcript)).toMatchObject({
			provider: 'anthropic',
			launch: 'started',
			progress: 'working',
			result: 'completed',
		})
	})
})

describe('Claude terminal result normalization', () => {
	it('uses the failure subtype when the result reason is empty', () => {
		const state = agent_event.read(
			lines({ type: 'result', is_error: true, result: ' ', subtype: 'error_max_turns' }),
		)

		expect(state).toMatchObject({
			provider: 'anthropic',
			result: 'failed',
			reason: 'error_max_turns',
		})
	})

	it('normalizes successful Claude usage without inventing missing counts', () => {
		const measured = agent_event.read(
			lines({
				type: 'result',
				is_error: false,
				usage: { input_tokens: 12, cache_read_input_tokens: 3, output_tokens: 4 },
			}),
		)

		expect(measured.usage).toStrictEqual({
			input_tokens: 12,
			cached_input_tokens: 3,
			output_tokens: 4,
		})
		expect(agent_event.read(lines({ type: 'result', is_error: false })).usage).toBeUndefined()
	})
})

describe('Codex event normalization', () => {
	it('normalizes launch, progress and failure around a partial line', () => {
		const complete = lines(
			{ type: THREAD_STARTED, thread_id: 'thread' },
			{ type: 'item.started' },
			{ type: 'item.completed', item: { type: 'agent_message', text: CHECKING_GATE } },
			{ type: TURN_FAILED, error: { message: BUDGET_EXCEEDED } },
		)
		const transcript = complete.replace(
			'\n{"type":"turn.failed"',
			'\n{partial\n{"type":"turn.failed"',
		)

		expect(agent_event.read(transcript)).toStrictEqual({
			provider: 'openai',
			launch: 'started',
			progress: CHECKING_GATE,
			result: 'failed',
			reason: BUDGET_EXCEEDED,
			usage: undefined,
		})
	})

	it('keeps Codex usage only when the completed event reports it', () => {
		const measured = lines({
			type: TURN_COMPLETED,
			usage: { input_tokens: 12, cached_input_tokens: 3, output_tokens: 4 },
		})

		expect(agent_event.read(measured).usage).toStrictEqual({
			input_tokens: 12,
			cached_input_tokens: 3,
			output_tokens: 4,
		})
		expect(agent_event.read(lines({ type: TURN_COMPLETED })).usage).toBeUndefined()
	})
})

describe('malformed event output', () => {
	it('reads only the latest appended launch', () => {
		const transcript = [
			lines({ type: TURN_FAILED, error: { message: BUDGET_EXCEEDED } }),
			'=== 2026-09-16T00:00:00Z · started by process 42 · codex ===',
			lines({ type: THREAD_STARTED }),
		].join('\n')

		expect(agent_event.read(transcript)).toMatchObject({
			provider: 'openai',
			launch: 'started',
			result: 'running',
			reason: undefined,
		})
	})

	it('does not invent a provider or result from malformed output', () => {
		expect(agent_event.read('not-json')).toStrictEqual({
			provider: undefined,
			launch: 'pending',
			progress: undefined,
			result: 'running',
			reason: undefined,
			usage: undefined,
		})
	})
})
