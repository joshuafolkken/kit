import type { FollowupStage } from '#scripts/followup/git-followup-stages'
import { json_value } from '#scripts/lib/json-value'
import {
	transcript_record,
	type TranscriptBlock,
	type TranscriptContent,
	type TranscriptMessage,
	type TranscriptRecord,
} from '#scripts/lib/transcript-record'
import { time_background } from './time-background'
import { time_followup_stage } from './time-followup-stage'
import { time_instant } from './time-instant'
import { time_reported_failure } from './time-reported-failure'

// One line of a session transcript, read into the shape the span walk works on.
//
// It moved out of `time-spans.ts` when that file passed its length limit — the seam that file is
// already cut along elsewhere (`time-shell.ts`, `time-single-check.ts`), where the *reading* of a
// field lives beside the field and the arithmetic stays next door. What is here is nothing about
// time: the two records a line yields, and the read that turns a parsed line into one.
//
// **The block reader is not `cost-blocks.ts` and could not have been.** That module flattens every
// line into one list of blocks for a token estimate, dropping the `id` / `tool_use_id` pair a call is
// matched to its result by and the line boundary a timestamp belongs to. Both are the whole input
// here.
//
// The line's schema is `transcript-record.ts`'s, shared with every other reader of these lines. A
// message `id` groups the lines of one assistant turn — Claude Code writes one line per content block
// — so "how many calls did that turn make" groups by it. `gitBranch` is where the issue number lives
// (`josh git` names a branch `<N>-<slug>`), read here so `josh time --issue` and `josh cost --issue`
// answer from the same field. A `tool_result`'s `is_error` is read as three answers — absent for the
// tools that never report one — and its `content` only to recover the outcome a pipeline threw away.

const UNKNOWN_BRANCH = ''
// The field an attachment line carries the notice in, named rather than written as a literal.
const PROMPT_KEY = 'prompt'
const NO_MESSAGE_ID = ''
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
// The label the harness puts in front of a Stop hook's block reason when it sends the turn back.
// The reason follows on the next line, opening with the same `⛔` a deny does.
const STOP_FEEDBACK_LABEL = /^Stop hook feedback:\s*/u
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
}

interface TranscriptLine {
	type: string
	timestamp_ms: number
	branch: string
	// The background run this line is the harness's end-of-task notice for — or the `TaskStop` result
	// that stopped it, which gets no notice — and `''` for every other line. It is read here rather than downstream for the reason every
	// derived field above is: the notice is the line's whole content, which a span does not keep, and
	// it is the only thing in a transcript that says a command had *finished* rather than merely been
	// looked at.
	finished_background: string
	// The assistant message this line is one block of, or `''` where the line carries none — a user
	// line, or an assistant line written without an id. The empty string is never treated as a group:
	// every line lacking an id would otherwise fall into one bucket spanning the whole file.
	message_id: string
	blocks: Array<Block>
	// The guard whose Stop-hook block sent this turn back, or `''` for every other line
	// — read the way `Block.refusal_guard` is, off the reason's opening.
	stop_guard: string
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
	const trimmed = text.trimStart().replace(HOOK_ERROR_LABEL, '')
	if (!trimmed.startsWith(REFUSAL_MARKER)) return ''

	const headline = trimmed.slice(REFUSAL_MARKER.length).split('\n', 1)[0]?.trimStart() ?? ''
	const colon = headline.indexOf(':')

	return (colon === -1 ? headline : headline.slice(0, colon)).trim()
}

// **Only the harness's own feedback line counts.** It writes a Stop block back as a user turn whose
// whole body is `Stop hook feedback:` and the reason, so a prompt that merely quotes one never opens
// with the label and reads `''`.
function stop_guard_of(data: TranscriptRecord): string {
	const content = data.message?.content
	if (typeof content !== 'string' || !STOP_FEEDBACK_LABEL.test(content)) return ''

	return guard_from_refusal(content.replace(STOP_FEEDBACK_LABEL, ''))
}

function token_lines_of(text: string): Array<string> {
	return text
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => TOKEN_LINE.test(line))
		.slice(0, TOKEN_LINE_LIMIT)
}

// **The body is flattened once and both readers are handed the text.** `result_text` is what turns a
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
	}
}

// A user turn written as a bare string carries no blocks, which is exactly right: it is a prompt,
// and a prompt has no tool result to match.
function to_blocks(content: TranscriptContent | null | undefined): Array<Block> {
	return typeof content === 'string' || content === null || content === undefined
		? []
		: content.map((block) => to_block(block))
}

// The two fields read off `message`, taken together because they are one reading: an assistant turn
// is written as one line per content block with the message's id repeated on each, so the id is what
// says which blocks belonged to the same turn.
function message_fields(
	message: TranscriptMessage | null | undefined,
): Pick<TranscriptLine, 'message_id' | 'blocks'> {
	return { message_id: message?.id ?? NO_MESSAGE_ID, blocks: to_blocks(message?.content) }
}

// **One notice reaches the transcript on any of three line kinds, and which of them a session holds
// varies**. The harness writes it on a `queue-operation` line when the notice
// is generated, on an `attachment` line when it is delivered, and on a `user` line where it enters the
// conversation — and a run measured against one carrier alone came back unmeasured whenever the
// session happened to hold a different one. All three are read, and `time_background.finished_at`
// keeps the earliest instant per id, so what is paired with the launch is when the task *ended* rather
// than when the run was told about it.
function notice_text(data: TranscriptRecord): string {
	const attachment = json_value.is_record(data.attachment) ? data.attachment[PROMPT_KEY] : undefined
	const carried = [data.message?.content, data.content, attachment]

	return carried.find((one): one is string => typeof one === 'string') ?? ''
}

// The task a `TaskStop` result on this line stopped, which is an end the harness writes no notice for.
// Its result body is a plain string, so only string contents are read and nothing is flattened again.
function stopped_background(content: TranscriptContent | null | undefined): string {
	if (!Array.isArray(content)) return time_background.NO_BACKGROUND

	const ids = content.map((block) =>
		typeof block.content === 'string' ? time_background.stopped_id(block.content) : '',
	)

	return ids.find((id) => id !== time_background.NO_BACKGROUND) ?? time_background.NO_BACKGROUND
}

// The task this line reports the end of: the harness's notice, or else a `TaskStop` result.
function finished_background(data: TranscriptRecord): string {
	const notice = time_background.finished_id(notice_text(data))

	return notice === time_background.NO_BACKGROUND
		? stopped_background(data.message?.content)
		: notice
}

// A line without a parseable timestamp is dropped rather than dated: it has no place on a timeline,
// and inventing one would move every span around it.
function to_line(data: TranscriptRecord): TranscriptLine | undefined {
	const timestamp_ms = time_instant.parse_instant(data.timestamp)

	if (timestamp_ms === undefined) return undefined

	return {
		type: data.type ?? '',
		timestamp_ms,
		branch: data.gitBranch ?? UNKNOWN_BRANCH,
		finished_background: finished_background(data),
		stop_guard: stop_guard_of(data),
		...message_fields(data.message),
	}
}

function parse_line(line: string): TranscriptLine | undefined {
	const record = transcript_record.parse(line)

	return record === undefined ? undefined : to_line(record)
}

// A whole transcript's text read as its parsed lines, the unparseable ones dropped.
function parse_text(text: string): Array<TranscriptLine> {
	return text.split('\n').flatMap((line) => parse_line(line) ?? [])
}

const time_transcript_line = {
	ERROR_TEXT_LIMIT,
	NO_MESSAGE_ID,
	TOKEN_LINE_LIMIT,
	guard_from_refusal,
	parse_line,
	parse_text,
}

export type { Block, TranscriptLine }
export { time_transcript_line }
