import { json_value } from '#scripts/json-value'
import { z } from 'zod'

// Reading the content blocks out of a session transcript (joshuafolkken/kit#1151).
//
// `cost-usage.ts` reads the same file for what each request was billed and skips everything else.
// This module reads the other half: what the conversation is actually made of. They stay apart
// because they aggregate differently — usage is deduplicated per `requestId`, since one response is
// written as several lines all carrying the same `usage`, while the content blocks on those lines
// are each written exactly once and must not be deduplicated.
//
// **Thinking arrives here empty, and that is not a defect.** Claude Code writes a `thinking` block
// with its `signature` but with `thinking` set to `''` — 118 blocks, 0 bytes, in the transcript this
// was measured on, and the same in every other session checked. The thinking count therefore comes
// from `usage.output_tokens_details.thinking_tokens`, which is a real API-reported number rather
// than an estimate; `cost-composition.ts` is where the two sources are joined.

const CONTENT_ITEM_SCHEMA = z.object({ text: z.string().nullish() })
const RESULT_CONTENT_SCHEMA = z.union([z.string(), z.array(CONTENT_ITEM_SCHEMA)])

// Every field is optional, including `type`. A required field would make one unexpected block fail
// the whole array it sits in, and with it every other block on that line — an entire assistant turn
// dropped from the table because one tool wrote a shape this reader had not seen. A block that
// parses to nothing contributes nothing, which is the cost it should have.
const BLOCK_SCHEMA = z.object({
	type: z.string().nullish(),
	text: z.string().nullish(),
	name: z.string().nullish(),
	input: z.unknown().nullish(),
	content: RESULT_CONTENT_SCHEMA.nullish(),
})

const LINE_CONTENT_SCHEMA = z.union([z.string(), z.array(BLOCK_SCHEMA)])
const MESSAGE_SCHEMA = z.object({ content: LINE_CONTENT_SCHEMA.nullish() })
const CONTENT_LINE_SCHEMA = z.object({ type: z.string(), message: MESSAGE_SCHEMA.nullish() })

type RawBlock = z.infer<typeof BLOCK_SCHEMA>

const TEXT_TYPE = 'text'
const TOOL_USE_TYPE = 'tool_use'
const TOOL_RESULT_TYPE = 'tool_result'
const BASH_TOOL = 'Bash'
const COMMAND_KEY = 'command'

// One block, reduced to what a token estimate needs. `command` is split out from the rest of a Bash
// tool_use's input because the command body is the quantity joshuafolkken/kit#1150 measured at 30.2%
// of one run's context and joshuafolkken/kit#1159 has to re-measure — folded into the rest of the
// input it would not be readable at all.
interface ContentBlock {
	type: string
	tool_name: string
	command: string
	text: string
}

function json_of(value: unknown): string {
	return value === undefined || value === null ? '' : JSON.stringify(value)
}

// The Bash command body, and the input with that key removed. Only Bash is split: another tool's
// `command` key, if one ever existed, is not the quantity being tracked and folding it in would
// report a number nobody measured.
function split_bash_input(input: unknown): { command: string; rest: string } {
	if (!json_value.is_record(input)) return { command: '', rest: json_of(input) }

	const command = input[COMMAND_KEY]
	const rest = Object.entries(input).filter(([key]) => key !== COMMAND_KEY)

	return {
		command: typeof command === 'string' ? command : '',
		rest: json_of(Object.fromEntries(rest)),
	}
}

function to_tool_use(block: RawBlock): ContentBlock {
	const tool_name = block.name ?? ''
	const is_bash = tool_name === BASH_TOOL
	const { command, rest } = is_bash
		? split_bash_input(block.input)
		: { command: '', rest: json_of(block.input) }

	return { type: TOOL_USE_TYPE, tool_name, command, text: rest }
}

// A tool result is either a plain string or a list of blocks. Only the textual items are counted:
// an image block carries no text here, and inventing a size for it would put a made-up number in a
// table whose whole purpose is to be compared against another run's.
function result_text(content: string | ReadonlyArray<z.infer<typeof CONTENT_ITEM_SCHEMA>>): string {
	if (typeof content === 'string') return content

	return content.map((item) => item.text ?? '').join('')
}

// Everything that is not a tool call: a result contributes its textual content, and anything else —
// text, thinking, a block type this reader has never seen — contributes its `text`, which for
// thinking is the empty string Claude Code writes there.
function to_plain_block(block: RawBlock): ContentBlock {
	const base = { type: block.type ?? '', tool_name: '', command: '' }
	const text =
		block.type === TOOL_RESULT_TYPE ? result_text(block.content ?? '') : (block.text ?? '')

	return { ...base, text }
}

function to_block(block: RawBlock): ContentBlock {
	return block.type === TOOL_USE_TYPE ? to_tool_use(block) : to_plain_block(block)
}

// A user turn whose content is a bare string — the prompt itself, plus whatever a `UserPromptSubmit`
// hook injected into it. Counted as text, which is what it is.
function to_blocks(content: string | ReadonlyArray<RawBlock>): Array<ContentBlock> {
	if (typeof content === 'string') {
		return [{ type: TEXT_TYPE, tool_name: '', command: '', text: content }]
	}

	return content.map((block) => to_block(block))
}

// A blank line, a line that is not JSON, and a line carrying no message content are one answer:
// nothing to count. With `BLOCK_SCHEMA` accepting anything object-shaped, the only line lost whole
// is one that is not JSON at all — which `cost-usage.ts` already counts as unparseable, so
// reporting it again here would double one missing-data figure.
function content_of(line: string): z.infer<typeof LINE_CONTENT_SCHEMA> | undefined {
	const parsed = CONTENT_LINE_SCHEMA.safeParse(json_value.parse_or_undefined(line))

	return parsed.success ? (parsed.data.message?.content ?? undefined) : undefined
}

function parse_line(line: string): Array<ContentBlock> {
	const content = content_of(line)

	return content === undefined ? [] : to_blocks(content)
}

function parse_content(text: string): Array<ContentBlock> {
	return text.split('\n').flatMap((line) => parse_line(line))
}

const cost_blocks = {
	BASH_TOOL,
	TEXT_TYPE,
	TOOL_USE_TYPE,
	TOOL_RESULT_TYPE,
	parse_line,
	parse_content,
}

export type { ContentBlock }
export { cost_blocks }
