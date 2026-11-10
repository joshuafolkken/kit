import type { FollowupStage } from '#scripts/followup/git-followup-stages'
import type { TranscriptBlock, TranscriptContent } from '#scripts/lib/transcript-record'
import { time_background } from './time-background'
import { time_followup_stage } from './time-followup-stage'
import { time_reported_failure } from './time-reported-failure'

// One content block of a transcript line, read into the shape the span walk works on.
//
// It moved out of `time-transcript-line.ts` when that file reached its length limit
// (joshuafolkken/kit#7055): the block is read on its own, and the line only gathers its blocks beside
// the fields read off the line itself.
//
// **The block reader is not `cost-blocks.ts` and could not have been.** That module flattens every
// line into one list of blocks for a token estimate, dropping the `id` / `tool_use_id` pair a call is
// matched to its result by. A `tool_result`'s `is_error` is read as three answers — absent for the
// tools that never report one — and its `content` only to recover the outcome a pipeline threw away.

// How much of an errored body is kept. A refusal's body *is* the reason the
// harness wrote back, from its first character, so an opening this long identifies the speaker
// without retaining the output of every failed command a session ran.
const ERROR_TEXT_LIMIT = 256
// The icon every guard refusal opens with. It is not `status_icons.FAIL_ICON`
// — that one (`✗`) marks a josh check's failing item, which `has_failure_line` scans for; this one
// marks a PreToolUse hook's *deny* reason, which is a different body carried in a different result. No
// shared constant exists because each guard writes the literal in its own reason, so the one place a
// refusal is *detected* names it here.
const REFUSAL_MARKER = '⛔'
// The label the harness puts in front of a PreToolUse hook's deny reason, naming the hook and the tool.
const HOOK_ERROR_LABEL = /^PreToolUse:\S+ hook error: /u
// A line that is one bare verdict token — `cut`, `busy`, `not-a-lane` — the single word a josh verdict
// command prints on standard output. How many are kept bounds the field the
// way `ERROR_TEXT_LIMIT` bounds `error_text`.
const TOKEN_LINE = /^[a-z][a-z-]*$/u
const TOKEN_LINE_LIMIT = 8

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
	// reads. The text itself is deliberately not kept: a field holding it
	// would retain every byte the session's tools printed for the length of the parse.
	has_failure_line: boolean
	// The stage rows a `pnpm josh followup` call printed into its own output.
	// Read here for the same reason the bit above is, and it obeys the same
	// prohibition: what is kept is the ten-odd parsed laps, never the body they were read from. Empty
	// for every other tool result, which is nearly all of them.
	followup_stages: ReadonlyArray<FollowupStage>
	// The opening of the body of a result the harness wrote back as a failure, and `''` for every
	// other block. It obeys the same prohibition as the two fields above —
	// what is kept is a bounded opening, never the whole body — and it exists so a reader asking
	// which refusal a line carried can be answered from the parsed block rather than by matching
	// `"is_error":true` against the raw line, a test one whitespace in the serializer defeats and
	// which cannot tell one errored block from another on the same line.
	error_text: string
	// Which guard refused this call, read off the opening of an errored result and `''` for every other
	// block. It obeys the same prohibition as `error_text` — what is kept is a
	// short label, never the body — and it exists so the per-guard refusal breakdown can be answered from
	// the parsed block rather than by re-scanning the body downstream. `''` where the result was not a
	// `⛔` refusal, so a reader tells "no guard spoke" from "this guard spoke" without a second parse.
	refusal_guard: string
	// The bare-token lines of a result that did not fail, and `[]` for every other block.
	// It obeys the same prohibition as `error_text` — what is kept is a few
	// single words, never the body — and it exists so the verdict a josh command answered with
	// (`run:cut`'s `cut`) is read from the parsed block rather than by searching the raw line.
	token_lines: ReadonlyArray<string>
	// The id the harness assigned to a command it took into the background, and `''` for every other
	// block. It is the fourth field read off the body under the same
	// prohibition as the three above — what is kept is the id, never the text it was read from — and
	// it is what pairs a launch with the call that later reads its output, so the minutes the command
	// actually ran can be placed on the timeline instead of only the seconds its launch call took.
	background_id: string
	// The id of a subagent this block launched into the background, and `''` for every other block
	// — apart from `background_id` so the timeline windows stay commands only.
	agent_id: string
	// How many characters the body carried, and `0` for a block with none — the size a tool result
	// adds to every later request's context, which `cost:audit` sums per tool (joshuafolkken/kit#7055).
	// It obeys the same prohibition: the count is kept, never the body.
	result_chars: number
}

// The four string fields, defaulted together and apart from the two that are not strings. Split out
// so neither half carries every `??` in the block: read as one function the defaulting alone reached
// the complexity limit, and the next field added would have had to be squeezed in beside them.
function block_names(raw: TranscriptBlock): Pick<Block, 'type' | 'name' | 'id' | 'result_id'> {
	return {
		type: raw.type ?? '',
		name: raw.name ?? '',
		id: raw.id ?? '',
		result_id: raw.tool_use_id ?? '',
	}
}

// The body a refusal opens with, the harness's own label stripped — shared with `rule-value.ts`.
function refusal_body(text: string): string {
	return text.trimStart().replace(HOOK_ERROR_LABEL, '')
}

// **A refusal is identified by what its body opens with, never by what it carries inside**.
// The hook denies a call on behalf of the one guard whose trigger fired and
// writes that guard's reason back as the whole result, so the speaker is the token after the `⛔` and
// before the first `:` — `⛔ pre-gate cut: …` is `pre-gate cut`. A reason with no colon (a headline
// like `⛔ scoped checks not green on this tree`) is taken whole. Reading the opening rather than
// searching the body is what stops a result that merely quoted a reason being read as a refusal.
//
// **The harness writes the reason behind its own label** — `PreToolUse:Edit hook error: ⛔ …` — so that
// label is stripped before the opening is read. Without it no live refusal
// carried a guard: the fixtures wrote the bare `⛔` body and passed while every recorded one read `''`.
function guard_from_refusal(text: string): string {
	const trimmed = refusal_body(text)
	if (!trimmed.startsWith(REFUSAL_MARKER)) return ''

	const headline = trimmed.slice(REFUSAL_MARKER.length).split('\n', 1)[0]?.trimStart() ?? ''
	const colon = headline.indexOf(':')

	return (colon === -1 ? headline : headline.slice(0, colon)).trim()
}

function token_lines_of(text: string): Array<string> {
	return text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => TOKEN_LINE.test(line))
		.slice(0, TOKEN_LINE_LIMIT)
}

// **The body is flattened once and every reader is handed the text.** `result_text` is what turns a
// content field that may be a string or a list of blocks into one string, and it is idempotent on a
// string — so passing its own output back to `has_failure_line` reads exactly as passing the raw
// field did, at one flattening instead of two.
function to_block(raw: TranscriptBlock): Block {
	const text = time_reported_failure.result_text(raw.content)
	const is_error = raw.is_error ?? undefined

	return {
		...block_names(raw),
		input: raw.input,
		is_error,
		has_failure_line: time_reported_failure.has_failure_line(text),
		followup_stages: time_followup_stage.read_stages(text),
		error_text: is_error === true ? text.slice(0, ERROR_TEXT_LIMIT) : '',
		refusal_guard: is_error === true ? guard_from_refusal(text) : '',
		token_lines: is_error === true ? [] : token_lines_of(text),
		background_id: time_background.launch_id(text),
		agent_id: time_background.agent_launch_id(text),
		result_chars: text.length,
	}
}

// A user turn written as a bare string carries no blocks, which is exactly right: it is a prompt,
// and a prompt has no tool result to match.
function to_blocks(content: TranscriptContent | null | undefined): Array<Block> {
	return typeof content === 'string' || content === null || content === undefined
		? []
		: content.map((block) => to_block(block))
}

const time_transcript_block = {
	ERROR_TEXT_LIMIT,
	TOKEN_LINE_LIMIT,
	guard_from_refusal,
	refusal_body,
	to_blocks,
}

export type { Block }
export { time_transcript_block }
