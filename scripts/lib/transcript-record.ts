import { z } from 'zod'
import { json_value } from './json-value'

// One line of a Claude Code JSONL log — a session transcript, or the `stream-json` output of
// `claude -p`, which writes the same `{ type, message: { id, content } }` shape. Every reader of those
// lines parses through these schemas and takes what it needs from the record; a fix to the shape
// reaches all of them at once.
//
// **Every field is optional, including `type`.** A required field would make one unexpected block
// fail the whole array it sits in, and with it every other block on that line — an entire assistant
// turn dropped because one tool wrote a shape no reader had seen. A block that parses to nothing
// contributes nothing.

const TEXT_TYPE = 'text'
const TOOL_USE_TYPE = 'tool_use'
const TOOL_RESULT_TYPE = 'tool_result'

const BLOCK_SCHEMA = z.object({
	type: z.string().nullish(),
	text: z.string().nullish(),
	name: z.string().nullish(),
	id: z.string().nullish(),
	tool_use_id: z.string().nullish(),
	input: z.unknown().nullish(),
	// Whether the harness wrote a `tool_result` back as a failure — absent on every other block, and
	// on the results of tools that never report one.
	is_error: z.boolean().nullish(),
	// A result's body: a string or a list of blocks. Read as `unknown` because each reader flattens it
	// its own way, and a narrower type here would drop the whole line over one odd item.
	content: z.unknown().nullish(),
})

const CONTENT_SCHEMA = z.union([z.string(), z.array(BLOCK_SCHEMA)])
// `id` is the assistant *message* the line belongs to; Claude Code writes one line per content block,
// so a turn that issued two calls is several lines carrying one id.
const MESSAGE_SCHEMA = z.object({ id: z.string().nullish(), content: CONTENT_SCHEMA.nullish() })

const LINE_SCHEMA = z.object({
	type: z.string().nullish(),
	timestamp: z.string().nullish(),
	gitBranch: z.string().nullish(),
	// The two fields outside `message` the harness writes an end-of-task notice on. `unknown`, since a
	// string here would reject every line whose `content` is a list of blocks.
	content: z.unknown().nullish(),
	attachment: z.unknown().nullish(),
	message: MESSAGE_SCHEMA.nullish(),
})

type TranscriptBlock = z.infer<typeof BLOCK_SCHEMA>
type TranscriptContent = z.infer<typeof CONTENT_SCHEMA>
type TranscriptMessage = z.infer<typeof MESSAGE_SCHEMA>
type TranscriptRecord = z.infer<typeof LINE_SCHEMA>
type ToolCallBlock = TranscriptBlock & { name: string }

function read(value: unknown): TranscriptRecord | undefined {
	return LINE_SCHEMA.safeParse(value).data
}

// A blank line, a line that is not JSON and a line of another shape are one answer: `undefined`.
function parse(line: string): TranscriptRecord | undefined {
	return read(json_value.parse_or_undefined(line))
}

// The line's blocks. A message written as a bare string — a prompt — carries none.
function blocks_of(record: TranscriptRecord): ReadonlyArray<TranscriptBlock> {
	const content = record.message?.content

	return Array.isArray(content) ? content : []
}

function is_tool_call(block: TranscriptBlock): block is ToolCallBlock {
	return block.type === TOOL_USE_TYPE && typeof block.name === 'string'
}

// The calls a line made, in order. A `tool_use` block without a name is not a call anything can name.
function tool_calls_of(record: TranscriptRecord): Array<ToolCallBlock> {
	return blocks_of(record).filter((block) => is_tool_call(block))
}

const transcript_record = {
	TEXT_TYPE,
	TOOL_USE_TYPE,
	TOOL_RESULT_TYPE,
	read,
	parse,
	blocks_of,
	tool_calls_of,
}

export type { TranscriptBlock, TranscriptContent, TranscriptMessage, TranscriptRecord }
export { transcript_record }
