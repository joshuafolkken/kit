import { describe, expect, it } from 'vitest'
import { eval_transcript } from './eval-transcript'

// A recorded fragment of `claude -p --output-format stream-json --verbose`, trimmed to the shapes
// the parser has to tell apart. Kept as a fixture rather than generated, because the point is that
// the parser reads the stream the CLI actually writes.
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
		['result events', JSON.stringify({ type: 'result', result: 'Edit' })],
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
