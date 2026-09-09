import type { FollowupStage } from '#scripts/git/git-followup-stages'
import { json_value } from '#scripts/json-value'
import { z } from 'zod'
import { time_followup_stage } from './time-followup-stage'
import { time_instant } from './time-instant'
import { time_reported_failure } from './time-reported-failure'

// One line of a session transcript, read into the shape the span walk works on
// (joshuafolkken/kit#1406).
//
// It moved out of `time-spans.ts` when that file passed its length limit — the seam that file is
// already cut along elsewhere (`time-shell.ts`, `time-single-check.ts`), where the *reading* of a
// field lives beside the field and the arithmetic stays next door. What is here is the JSONL shape
// and nothing about time: schemas, the two records a line yields, and the parse that turns a string
// into one.
//
// **The block reader is not `cost-blocks.ts` and could not have been.** That module flattens every
// line into one list of blocks for a token estimate, dropping the `id` / `tool_use_id` pair a call is
// matched to its result by and the line boundary a timestamp belongs to. Both are the whole input
// here.

const BLOCK_SCHEMA = z.object({
	type: z.string().nullish(),
	name: z.string().nullish(),
	id: z.string().nullish(),

	tool_use_id: z.string().nullish(),
	input: z.unknown().nullish(),
	// Whether the harness wrote this result back as a failure (joshuafolkken/kit#1309). Present on a
	// `tool_result` block and on nothing else, and absent even there for the tools that never report
	// one — which is why it is read as three answers rather than as a boolean with a default.
	is_error: z.boolean().nullish(),
	// What the call printed. Read only to recover the outcome a pipeline threw away
	// (joshuafolkken/kit#1361): it is kept as flattened text rather than as blocks, because that is
	// the whole of what `time-reported-failure.ts` asks of it.
	content: z.unknown().nullish(),
})

const CONTENT_SCHEMA = z.union([z.string(), z.array(BLOCK_SCHEMA)])
// `id` is the assistant *message* the line belongs to, and Claude Code writes one line per content
// block — a turn that thought and then issued two calls is three lines carrying one id
// (joshuafolkken/kit#1329). Anything asking "how many calls did that turn make" therefore has to
// group by this field; counting one line's blocks answers one, whatever the turn actually did. Since
// joshuafolkken/kit#1406 the same field is what says how many *turns* a run had.
const MESSAGE_SCHEMA = z.object({ id: z.string().nullish(), content: CONTENT_SCHEMA.nullish() })

const LINE_SCHEMA = z.object({
	type: z.string().nullish(),
	timestamp: z.string().nullish(),
	// The branch the line was written on, which is where the issue number lives — `josh git` names a
	// branch `<N>-<slug>`. Read here rather than re-parsed by a second reader so `josh time --issue`
	// and `josh cost --issue` answer from the same field (joshuafolkken/kit#1268).
	gitBranch: z.string().nullish(),
	message: MESSAGE_SCHEMA.nullish(),
})

const UNKNOWN_BRANCH = ''
const NO_MESSAGE_ID = ''
// How much of an errored body is kept (joshuafolkken/kit#1642). A refusal's body *is* the reason the
// harness wrote back, from its first character, so an opening this long identifies the speaker
// without retaining the output of every failed command a session ran.
const ERROR_TEXT_LIMIT = 256

interface Block {
	type: string
	name: string
	id: string
	result_id: string
	input: unknown
	// `undefined` where the block carried no `is_error` field, which is a different fact from
	// `false`: one is a tool that reports no outcome, the other a call that succeeded.
	is_error: boolean | undefined
	// Whether the body carried a line opening with josh's failure icon — the one bit of it anything
	// reads (joshuafolkken/kit#1361). The text itself is deliberately not kept: a field holding it
	// would retain every byte the session's tools printed for the length of the parse.
	has_failure_line: boolean
	// The stage rows a `pnpm josh followup` call printed into its own output
	// (joshuafolkken/kit#1445). Read here for the same reason the bit above is, and it obeys the same
	// prohibition: what is kept is the ten-odd parsed laps, never the body they were read from. Empty
	// for every other tool result, which is nearly all of them.
	followup_stages: ReadonlyArray<FollowupStage>
	// The opening of the body of a result the harness wrote back as a failure, and `''` for every
	// other block (joshuafolkken/kit#1642). It obeys the same prohibition as the two fields above —
	// what is kept is a bounded opening, never the whole body — and it exists so a reader asking
	// which refusal a line carried can be answered from the parsed block rather than by matching
	// `"is_error":true` against the raw line, a test one whitespace in the serializer defeats and
	// which cannot tell one errored block from another on the same line.
	error_text: string
}

interface TranscriptLine {
	type: string
	timestamp_ms: number
	branch: string
	// The assistant message this line is one block of, or `''` where the line carries none — a user
	// line, or an assistant line written without an id. The empty string is never treated as a group:
	// every line lacking an id would otherwise fall into one bucket spanning the whole file.
	message_id: string
	blocks: Array<Block>
}

// The four string fields, defaulted together and apart from the two that are not strings. Split out
// so neither half carries every `??` in the block: read as one function the defaulting alone reached
// the complexity limit, and the next field added would have had to be squeezed in beside them.
function block_names(
	raw: z.infer<typeof BLOCK_SCHEMA>,
): Pick<Block, 'type' | 'name' | 'id' | 'result_id'> {
	return {
		type: raw.type ?? '',
		name: raw.name ?? '',
		id: raw.id ?? '',
		result_id: raw.tool_use_id ?? '',
	}
}

// **The body is flattened once and both readers are handed the text.** `result_text` is what turns a
// content field that may be a string or a list of blocks into one string, and it is idempotent on a
// string — so passing its own output back to `has_failure_line` reads exactly as passing the raw
// field did, at one flattening instead of two (joshuafolkken/kit#1445).
function to_block(raw: z.infer<typeof BLOCK_SCHEMA>): Block {
	const text = time_reported_failure.result_text(raw.content)

	return {
		...block_names(raw),
		input: raw.input,
		is_error: raw.is_error ?? undefined,
		has_failure_line: time_reported_failure.has_failure_line(text),
		followup_stages: time_followup_stage.read_stages(text),
		error_text: raw.is_error === true ? text.slice(0, ERROR_TEXT_LIMIT) : '',
	}
}

// A user turn written as a bare string carries no blocks, which is exactly right: it is a prompt,
// and a prompt has no tool result to match.
function to_blocks(
	content: string | Array<z.infer<typeof BLOCK_SCHEMA>> | null | undefined,
): Array<Block> {
	return typeof content === 'string' || content === null || content === undefined
		? []
		: content.map((block) => to_block(block))
}

// The two fields read off `message`, taken together because they are one reading: an assistant turn
// is written as one line per content block with the message's id repeated on each, so the id is what
// says which blocks belonged to the same turn.
function message_fields(
	message: z.infer<typeof MESSAGE_SCHEMA> | null | undefined,
): Pick<TranscriptLine, 'message_id' | 'blocks'> {
	return { message_id: message?.id ?? NO_MESSAGE_ID, blocks: to_blocks(message?.content) }
}

// A line without a parseable timestamp is dropped rather than dated: it has no place on a timeline,
// and inventing one would move every span around it.
function to_line(data: z.infer<typeof LINE_SCHEMA>): TranscriptLine | undefined {
	const timestamp_ms = time_instant.parse_instant(data.timestamp)

	if (timestamp_ms === undefined) return undefined

	return {
		type: data.type ?? '',
		timestamp_ms,
		branch: data.gitBranch ?? UNKNOWN_BRANCH,
		...message_fields(data.message),
	}
}

function parse_line(line: string): TranscriptLine | undefined {
	const parsed = LINE_SCHEMA.safeParse(json_value.parse_or_undefined(line))

	return parsed.success ? to_line(parsed.data) : undefined
}

const time_transcript_line = { ERROR_TEXT_LIMIT, NO_MESSAGE_ID, parse_line }

export type { Block, TranscriptLine }
export { time_transcript_line }
