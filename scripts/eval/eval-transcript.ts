import { z } from 'zod'

// `claude -p --output-format stream-json --verbose` writes one JSON object per line. Only the
// assistant messages carry `tool_use` blocks, and those blocks are the whole measurement: a name and
// the input it was called with, in the order the run made them. Everything else in the stream —
// reasoning, text, usage, the final result — is deliberately not read, because judging any of it
// would put the suite back to grading prose (joshuafolkken/kit#855).

const TOOL_USE_BLOCK_SCHEMA = z.looseObject({
	type: z.literal('tool_use'),
	name: z.string(),
	input: z.unknown(),
})

const MESSAGE_SCHEMA = z.looseObject({ content: z.array(z.unknown()).optional() })

const STREAM_EVENT_SCHEMA = z.looseObject({ message: MESSAGE_SCHEMA.optional() })

interface ToolCall {
	name: string
	input: string
}

function tool_call_in_block(block: unknown): ToolCall | undefined {
	const result = TOOL_USE_BLOCK_SCHEMA.safeParse(block)

	if (!result.success) return undefined

	return { name: result.data.name, input: JSON.stringify(result.data.input ?? {}) }
}

function tool_calls_in_content(content: ReadonlyArray<unknown>): ReadonlyArray<ToolCall> {
	return content.map((block) => tool_call_in_block(block)).filter((call) => call !== undefined)
}

// A malformed line is skipped rather than thrown on: the stream carries progress lines that are not
// events, and a run that produced a hundred good calls should not be unreadable because of one.
function tool_calls_in_line(line: string): ReadonlyArray<ToolCall> {
	if (line.trim() === '') return []

	try {
		const event = STREAM_EVENT_SCHEMA.parse(JSON.parse(line))

		return tool_calls_in_content(event.message?.content ?? [])
	} catch {
		return []
	}
}

function read_tool_calls(transcript: string): ReadonlyArray<ToolCall> {
	return transcript.split('\n').flatMap((line) => tool_calls_in_line(line))
}

const eval_transcript = { read_tool_calls }

export { eval_transcript }
export type { ToolCall }
