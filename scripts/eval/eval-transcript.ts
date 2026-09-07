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
// One line of the stream as a value, or `undefined` when it is blank or not JSON. Three readers ask
// different questions of the same lines, and a `try` around each is three chances for them to
// disagree about what an unreadable line means (joshuafolkken/kit#1001).
function parse_line(line: string): unknown {
	if (line.trim() === '') return undefined

	try {
		return JSON.parse(line)
	} catch {
		return undefined
	}
}

function tool_calls_in_line(line: string): ReadonlyArray<ToolCall> {
	const parsed = STREAM_EVENT_SCHEMA.safeParse(parse_line(line))

	if (!parsed.success) return []

	return tool_calls_in_content(parsed.data.message?.content ?? [])
}

// Whether the session got far enough to announce itself. `claude -p --output-format stream-json`
// writes a `{"type":"system","subtype":"init"}` line before anything else, so its presence is the
// observable difference between a session that never started and one that started and then died —
// two failures that both leave no tool calls and read identically without it
// (joshuafolkken/kit#1001).
const INIT_EVENT_SCHEMA = z.looseObject({ type: z.literal('system'), subtype: z.literal('init') })

function has_started(transcript: string): boolean {
	return transcript
		.split('\n')
		.some((line) => INIT_EVENT_SCHEMA.safeParse(parse_line(line)).success)
}

// The stream's own account of why it stopped, for the case stderr is silent — which is every one
// observed during joshuafolkken/kit#908: `session exited 1 without running` with nothing after it.
// The CLI reports a failed run as a `result` event carrying `is_error`, so the reason is in the
// transcript even when nothing reached stderr.
// `result` is `unknown` rather than `string`: typing it narrowly meant a payload carrying a non-string
// there failed the whole parse, and the `subtype` sitting beside it — a perfectly good reason — went
// with it, leaving the reasonless line this reader exists to remove (joshuafolkken/kit#1001).
// Every field but the discriminator is `unknown`: typing any of them narrowly means an unexpected
// value in *one* of them fails the whole parse and discards the others — which is how a perfectly
// good reason was lost beside a `result` that was not a string (joshuafolkken/kit#1001).
const RESULT_EVENT_SCHEMA = z.looseObject({
	type: z.literal('result'),
	is_error: z.unknown().optional(),
	subtype: z.unknown().optional(),
	result: z.unknown().optional(),
})

// An empty `result` is not a reason either, so it falls through to `subtype` rather than shadowing it.
function usable_reason(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function error_in_line(line: string): string | undefined {
	const parsed = RESULT_EVENT_SCHEMA.safeParse(parse_line(line))

	if (!parsed.success || parsed.data.is_error !== true) return undefined

	return usable_reason(parsed.data.result) ?? usable_reason(parsed.data.subtype)
}

function read_error_reason(transcript: string): string | undefined {
	return transcript
		.split('\n')
		.map((line) => error_in_line(line))
		.findLast((reason) => reason !== undefined && reason.trim() !== '')
}

function read_tool_calls(transcript: string): ReadonlyArray<ToolCall> {
	return transcript.split('\n').flatMap((line) => tool_calls_in_line(line))
}

// "The session ran and did not settle the rule" and "the session never reached the API" are different
// states, and only the first is worth a retry or a `unmeasured` verdict. The second is a setup
// failure that costs a whole Claude session to learn and returns nothing, so it is named here and
// separated everywhere downstream (joshuafolkken/kit#1197).
//
// Matched on the reason text because that is where it arrives: the CLI reports it as the `result` of
// a `type:"result"`, `is_error:true` line in the stdout stream, with stderr empty on every occurrence
// measured under joshuafolkken/kit#1001. Two phrasings rather than one — the CLI has emitted the
// wrapper sentence and the bare cause independently — and both are matched case-insensitively so a
// re-worded prefix does not silently turn an unreachable API back into `unmeasured`.
const UNREACHABLE_PATTERNS: ReadonlyArray<RegExp> = [
	/unable to connect to api/iu,
	/connection\s*refused/iu,
]

function is_unreachable_reason(reason: string | undefined): boolean {
	if (reason === undefined) return false

	return UNREACHABLE_PATTERNS.some((pattern) => pattern.test(reason))
}

const eval_transcript = {
	has_started,
	is_unreachable_reason,
	read_error_reason,
	read_tool_calls,
}

export { eval_transcript }
export type { ToolCall }
