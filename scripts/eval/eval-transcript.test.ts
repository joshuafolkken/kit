import { describe, expect, it } from 'vitest'
import { eval_transcript } from './eval-transcript'

// A recorded fragment of `claude -p --output-format stream-json --verbose`, trimmed to the shapes
// the parser has to tell apart. Kept as a fixture rather than generated, because the point is that
// the parser reads the stream the CLI actually writes.
const RESULT_EVENT_TYPE = 'result'
const FIRST_PATH = '/s/a'
const BUMP_COMMAND = 'pnpm josh bump minor'

function assistant_line(...blocks: ReadonlyArray<unknown>): string {
	return JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: blocks } })
}

function tool_use(name: string, input: Record<string, unknown>): Record<string, unknown> {
	return { type: 'tool_use', id: 'toolu_1', name, input }
}

describe('eval_transcript.read_tool_calls', () => {
	it('reads the calls in the order the run made them', () => {
		const transcript = [
			assistant_line(tool_use('Read', { file_path: '/s/CLAUDE.md' })),
			assistant_line(tool_use('Bash', { command: 'gh issue create --title x' })),
		].join('\n')

		expect(eval_transcript.read_tool_calls(transcript).map((call) => call.name)).toStrictEqual([
			'Read',
			'Bash',
		])
	})

	it('keeps the input, so a scenario can match on the command rather than the tool', () => {
		const transcript = assistant_line(tool_use('Bash', { command: BUMP_COMMAND }))

		expect(eval_transcript.read_tool_calls(transcript)[0]?.input).toContain(BUMP_COMMAND)
	})

	it('reads every call in one message', () => {
		const transcript = assistant_line(
			tool_use('Read', { file_path: FIRST_PATH }),
			tool_use('Read', { file_path: '/s/b' }),
		)

		expect(eval_transcript.read_tool_calls(transcript)).toHaveLength(2)
	})

	// Judging text would put the suite back to grading prose, which is the thing kit#855 exists to
	// replace — so anything that is not a tool call is not a measurement.
	it.each([
		['text blocks', assistant_line({ type: 'text', text: 'I will not edit anything.' })],
		['thinking blocks', assistant_line({ type: 'thinking', thinking: 'Bash: rm -rf /' })],
		['system events', JSON.stringify({ type: 'system', subtype: 'init' })],
		['result events', JSON.stringify({ type: RESULT_EVENT_TYPE, result: 'Edit' })],
	])('reads no call from %s', (_label, transcript) => {
		expect(eval_transcript.read_tool_calls(transcript)).toStrictEqual([])
	})
})

// The stream is not only assistant events, and not every line in it is even JSON.
describe('eval_transcript.read_tool_calls — what it ignores', () => {
	// The stream carries lines that are not events at all. A run that produced a hundred good calls
	// should not become unreadable because of one of them.
	it('skips a malformed line and keeps the calls around it', () => {
		const transcript = [
			assistant_line(tool_use('Read', { file_path: FIRST_PATH })),
			'not json at all',
			'',
			assistant_line(tool_use('Edit', { file_path: '/s/b' })),
		].join('\n')

		expect(eval_transcript.read_tool_calls(transcript).map((call) => call.name)).toStrictEqual([
			'Read',
			'Edit',
		])
	})
})

// joshuafolkken/kit#1001: a session that never started and one that started and then died both leave
// no tool calls. The stream's own `init` event is the observable difference, and the `result` event
// carries the reason in the case that actually occurred — an empty stderr.
const STARTED_INIT_LINE = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'x' })

const RATE_LIMITED = 'rate limited'
const DURING_EXECUTION = 'error_during_execution'

function result_line(fields: Record<string, unknown>): string {
	return JSON.stringify({ type: RESULT_EVENT_TYPE, ...fields })
}

function reason_of(fields: Record<string, unknown>): string | undefined {
	return eval_transcript.read_error_reason(result_line(fields))
}

describe('eval_transcript.has_started', () => {
	it('is false for an empty transcript', () => {
		expect(eval_transcript.has_started('')).toBe(false)
	})

	it('is true once the stream announced itself', () => {
		expect(eval_transcript.has_started(STARTED_INIT_LINE)).toBe(true)
	})

	it('is true when the init line is followed by others', () => {
		expect(eval_transcript.has_started(`${STARTED_INIT_LINE}\n{"type":"assistant"}`)).toBe(true)
	})

	it('is false for a stream that carries other events but no init', () => {
		expect(eval_transcript.has_started('{"type":"assistant"}')).toBe(false)
	})

	it('is false for unreadable output', () => {
		expect(eval_transcript.has_started('not json\nalso not json')).toBe(false)
	})
})

describe('eval_transcript.read_error_reason', () => {
	it('reads the reason from a failed result event', () => {
		expect(reason_of({ is_error: true, result: RATE_LIMITED })).toBe(RATE_LIMITED)
	})

	it('falls back to the subtype when there is no message', () => {
		expect(
			eval_transcript.read_error_reason(result_line({ is_error: true, subtype: DURING_EXECUTION })),
		).toBe(DURING_EXECUTION)
	})

	it('is undefined for a successful result event', () => {
		expect(reason_of({ is_error: false, result: 'all good' })).toBeUndefined()
	})

	it('is undefined for an empty transcript', () => {
		expect(eval_transcript.read_error_reason('')).toBeUndefined()
	})

	// joshuafolkken/kit#1001: `result` was typed as a string, so a payload carrying anything else there
	// failed the whole parse and took the perfectly good `subtype` with it — leaving the reasonless
	// line this reader exists to remove.
	it('falls back to the subtype when the result is not a string', () => {
		expect(reason_of({ is_error: true, result: { code: 7 }, subtype: DURING_EXECUTION })).toBe(
			DURING_EXECUTION,
		)
	})

	it('falls back to the subtype when the result is empty', () => {
		expect(reason_of({ is_error: true, result: ' '.repeat(3), subtype: DURING_EXECUTION })).toBe(
			DURING_EXECUTION,
		)
	})

	// The last one wins: a retried turn can emit more than one, and the final answer is why it ended.
	it('takes the last reason when there is more than one', () => {
		const transcript = [
			result_line({ is_error: true, result: 'first' }),
			result_line({ is_error: true, result: 'second' }),
		].join('\n')

		expect(eval_transcript.read_error_reason(transcript)).toBe('second')
	})
})
