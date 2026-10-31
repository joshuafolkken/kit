import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// One lane session's transcript reduced to its tool calls: each `tool_use` an `assistant` line carries,
// joined by its id to the `tool_result` a later `user` line carries, so `josh lane:stats` can time a
// call as the gap between the two lines (joshuafolkken/kit#4418).
//
// **A backgrounded call is kept but not timed.** Its result line is the immediate "running in the
// background" notice, so the gap measures nothing the run waited on; `duration_ms` is `undefined` for
// it, as for a call whose result never arrived (an interrupted turn).
//
// **The tool's name is kept** (`Bash`, `Edit`, …), so `josh lane:value edit` can time the edits apart
// from the shell calls, **and so is its lane** — the transcript directory every session of one lane
// (its child, its ship reviewer) writes under — so a per-lane value divides by lanes, not sessions
// (joshuafolkken/kit#4630).
//
// **A subagent call keeps its agent type and model** — `subagent_type`, the harness's
// `general-purpose` when absent, and `model` when named — so the implement's subagent time splits by
// the agent dispatched (joshuafolkken/kit#5297). **A review's pass and level are kept too** — the
// interaction review by its brief's path or block, the round-2 verification pass by its prompt's words
// (`run-ship-review.ts`), and the level when the prompt opens with it — so `josh lane:breakdown` tells
// the reviews apart (joshuafolkken/kit#5539); the prompt itself is not kept.

interface Subagent {
	type: string
	model: string | undefined
	level?: string | undefined
	pass?: string | undefined
}

interface ToolCall {
	session_id: string
	lane: string
	started_ms: number
	duration_ms: number | undefined
	tool: string | undefined
	background: boolean
	command: string | undefined
	subagent: Subagent | undefined
	output: string
}

interface ToolUse {
	started_ms: number
	tool: string | undefined
	background: boolean
	command: string | undefined
	subagent: Subagent | undefined
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
	subagent_type?: unknown
	model?: unknown
	prompt?: unknown
}

interface CallInput {
	background: boolean
	command: string | undefined
	subagent: Subagent
}

const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task'])
const GENERAL_PURPOSE = 'general-purpose'
const LEVEL_LINE = /^(?:low|medium|high|xhigh|max)$/u
// The words each pass's prompt carries: the interaction brief's path or block, the round-2 prompt's lead.
const PASS_MARKERS: ReadonlyArray<readonly [ReadonlyArray<string>, string]> = [
	[['review-brief-interaction-', '## Interaction review'], 'interaction'],
	[['round-2 verification pass'], 'round 2'],
]

function string_or_undefined(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined
}

// A named string, `undefined` for an empty or non-string one.
function named(value: unknown): string | undefined {
	return value === '' ? undefined : string_or_undefined(value)
}

// The level a review brief opens with, `undefined` for a prompt that opens otherwise.
function level_of(prompt: string): string | undefined {
	const [first = ''] = prompt.split('\n', 1)

	return LEVEL_LINE.test(first.trim()) ? first.trim() : undefined
}

function pass_of(prompt: string): string | undefined {
	return PASS_MARKERS.find(([markers]) => markers.some((marker) => prompt.includes(marker)))?.[1]
}

// A review's level and pass, read off the prompt a subagent call carries.
function brief_of(value: unknown): Pick<Subagent, 'level' | 'pass'> {
	const prompt = string_or_undefined(value) ?? ''

	return { level: level_of(prompt), pass: pass_of(prompt) }
}

function subagent_of(input: RawInput | null | undefined): Subagent {
	return {
		type: named(input?.subagent_type) ?? GENERAL_PURPOSE,
		model: named(input?.model),
		...brief_of(input?.prompt),
	}
}

function to_input(input: RawInput | null | undefined): CallInput {
	return {
		background: input?.run_in_background === true,
		command: string_or_undefined(input?.command),
		subagent: subagent_of(input),
	}
}

const TEXT_PARTS_SCHEMA = z.array(z.object({ text: z.string().nullish() }))
// A result's text: a string, or the text parts of a block list; anything else reads as no output.
const RESULT_CONTENT_SCHEMA = z
	.union([z.string(), TEXT_PARTS_SCHEMA.transform(join_parts)])
	.catch('')
const INPUT_SCHEMA = z
	.object({
		command: z.unknown(),
		run_in_background: z.unknown(),
		subagent_type: z.unknown(),
		model: z.unknown(),
		prompt: z.unknown(),
	})
	.partial()

const BLOCK_SCHEMA = z.object({
	type: z.string(),
	id: z.string().nullish(),
	name: z.string().nullish(),
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

// The agent a subagent call dispatched; any other tool's input names none.
function subagent_in(tool: string | undefined, block: Block): Subagent | undefined {
	return SUBAGENT_TOOLS.has(tool ?? '') ? block.input.subagent : undefined
}

function record_use(pairs: Pairs, block: Block, started_ms: number): void {
	if (block.type !== 'tool_use' || !block.id) return

	const tool = block.name ?? undefined

	pairs.uses.set(block.id, { started_ms, tool, ...block.input, subagent: subagent_in(tool, block) })
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

// The transcript a call was read from: its session, and the lane that session belongs to.
type CallSource = Pick<ToolCall, 'session_id' | 'lane'>

function to_call(source: CallSource, use: ToolUse, result: ToolResult | undefined): ToolCall {
	const is_timed = result !== undefined && !use.background

	return {
		...source,
		started_ms: use.started_ms,
		duration_ms: is_timed ? result.ended_ms - use.started_ms : undefined,
		tool: use.tool,
		background: use.background,
		command: use.command,
		subagent: use.subagent,
		output: result?.output ?? '',
	}
}

// Every tool call `raw` — one transcript's text — records, in the order the calls were made.
function parse(source: CallSource, raw: string): Array<ToolCall> {
	const pairs: Pairs = { uses: new Map(), results: new Map() }
	const lines = raw.split('\n')

	for (const line of lines) record_line(pairs, line)

	return [...pairs.uses].map(([id, use]) => to_call(source, use, pairs.results.get(id)))
}

const lane_transcript_calls = { parse }

export type { Subagent, ToolCall }
export { lane_transcript_calls }
