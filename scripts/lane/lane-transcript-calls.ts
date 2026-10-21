import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// One lane session's transcript reduced to its tool calls: each `tool_use` an `assistant` line carries,
// joined by its id to the `tool_result` a later `user` line carries, so `josh lane:stats` can time a
// call as the gap between the two lines (joshuafolkken/kit#4418).
//
// **A backgrounded call is kept but not timed.** Its result line is the immediate "running in the
// background" notice, so the gap measures nothing the run waited on; `duration_ms` is `undefined` for
// it, as for a call whose result never arrived (an interrupted turn).

interface ToolCall {
	session_id: string
	started_ms: number
	duration_ms: number | undefined
	background: boolean
	command: string | undefined
	output: string
}

interface ToolUse {
	started_ms: number
	background: boolean
	command: string | undefined
}

interface ToolResult {
	ended_ms: number
	output: string
}

interface TextPart {
	text?: string | null | undefined
}

function join_parts(parts: ReadonlyArray<TextPart>): string {
	return parts.map((part) => part.text ?? '').join('\n')
}

interface RawInput {
	command?: unknown
	run_in_background?: unknown
}

interface CallInput {
	background: boolean
	command: string | undefined
}

function to_input(input: RawInput | null | undefined): CallInput {
	const command = input?.command

	return {
		background: input?.run_in_background === true,
		command: typeof command === 'string' ? command : undefined,
	}
}

const TEXT_PARTS_SCHEMA = z.array(z.object({ text: z.string().nullish() }))
// A result's text: a string, or the text parts of a block list; anything else reads as no output.
const RESULT_CONTENT_SCHEMA = z
	.union([z.string(), TEXT_PARTS_SCHEMA.transform(join_parts)])
	.catch('')
const INPUT_SCHEMA = z.object({ command: z.unknown(), run_in_background: z.unknown() }).partial()

const BLOCK_SCHEMA = z.object({
	type: z.string(),
	id: z.string().nullish(),
	input: INPUT_SCHEMA.nullish().transform(to_input),
	tool_use_id: z.string().nullish(),
	content: RESULT_CONTENT_SCHEMA.optional(),
})

type Block = z.infer<typeof BLOCK_SCHEMA>

function blocks_of(message: { content: Array<Block> } | null | undefined): Array<Block> {
	return message?.content ?? []
}

// A line that is not JSON, not a message, or carries no readable timestamp fails the parse.
const LINE_SCHEMA = z.object({
	timestamp: z.string().transform(Date.parse).pipe(z.number()),
	message: z
		.object({ content: z.array(BLOCK_SCHEMA).catch([]) })
		.nullish()
		.transform(blocks_of),
})

interface Pairs {
	uses: Map<string, ToolUse>
	results: Map<string, ToolResult>
}

function record_use(pairs: Pairs, block: Block, started_ms: number): void {
	if (block.type !== 'tool_use' || !block.id) return

	pairs.uses.set(block.id, { started_ms, ...block.input })
}

function record_result(pairs: Pairs, block: Block, ended_ms: number): void {
	if (block.type !== 'tool_result' || !block.tool_use_id) return

	pairs.results.set(block.tool_use_id, { ended_ms, output: block.content ?? '' })
}

function record_line(pairs: Pairs, line: string): void {
	const parsed = LINE_SCHEMA.safeParse(json_value.parse_or_undefined(line))

	if (!parsed.success) return

	const { timestamp, message } = parsed.data

	for (const block of message) {
		record_use(pairs, block, timestamp)
		record_result(pairs, block, timestamp)
	}
}

function to_call(session_id: string, use: ToolUse, result: ToolResult | undefined): ToolCall {
	const is_timed = result !== undefined && !use.background

	return {
		session_id,
		started_ms: use.started_ms,
		duration_ms: is_timed ? result.ended_ms - use.started_ms : undefined,
		background: use.background,
		command: use.command,
		output: result?.output ?? '',
	}
}

// Every tool call `raw` — one transcript's text — records, in the order the calls were made.
function parse(session_id: string, raw: string): Array<ToolCall> {
	const pairs: Pairs = { uses: new Map(), results: new Map() }
	const lines = raw.split('\n')

	for (const line of lines) record_line(pairs, line)

	return [...pairs.uses].map(([id, use]) => to_call(session_id, use, pairs.results.get(id)))
}

const lane_transcript_calls = { parse }

export type { ToolCall }
export { lane_transcript_calls }
