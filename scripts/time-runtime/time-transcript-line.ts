import { json_value } from '#scripts/lib/json-value'
import {
	transcript_record,
	type TranscriptContent,
	type TranscriptMessage,
	type TranscriptRecord,
} from '#scripts/lib/transcript-record'
import { time_background } from './time-background'
import { time_instant } from './time-instant'
import { time_transcript_block, type Block } from './time-transcript-block'

// One line of a session transcript, read into the shape the span walk works on.
//
// It moved out of `time-spans.ts` when that file passed its length limit — the seam that file is
// already cut along elsewhere (`time-shell.ts`, `time-single-check.ts`), where the *reading* of a
// field lives beside the field and the arithmetic stays next door. What is here is nothing about
// time: the record a line yields, and the read that turns a parsed line into one. Its blocks are read
// by `time-transcript-block.ts`, split out when this file reached its length limit
// (joshuafolkken/kit#7055).
//
// The line's schema is `transcript-record.ts`'s, shared with every other reader of these lines. A
// message `id` groups the lines of one assistant turn — Claude Code writes one line per content block
// — so "how many calls did that turn make" groups by it. `gitBranch` is where the issue number lives
// (`josh git` names a branch `<N>-<slug>`), read here so `josh time --issue` and `josh cost --issue`
// answer from the same field.

const UNKNOWN_BRANCH = ''
// The field an attachment line carries the notice in, named rather than written as a literal.
const PROMPT_KEY = 'prompt'
const NO_MESSAGE_ID = ''
// The label the harness puts in front of a Stop hook's block reason when it sends the turn back.
// The reason follows on the next line, opening with the same `⛔` a deny does.
const STOP_FEEDBACK_LABEL = /^Stop hook feedback:\s*/u

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
	// The reason a Stop-hook block sent this turn back with, its label stripped, or `''` for every
	// other line.
	stop_feedback: string
	// The guard whose Stop-hook block sent this turn back, or `''` for every other line
	// — read the way `Block.refusal_guard` is, off the reason's opening.
	stop_guard: string
	// The billed request an assistant line belongs to and the reasoning effort it ran at, `''` on every
	// other line — the pair `cost:audit` prices its effort breakdown by (joshuafolkken/kit#7055).
	request_id: string
	effort: string
}

// **Only the harness's own feedback line counts.** It writes a Stop block back as a user turn whose
// whole body is `Stop hook feedback:` and the reason, so a prompt that merely quotes one never opens
// with the label and reads `''`. The reason is kept whole, so `rule-value.ts` can match it to its row.
function stop_feedback_of(data: TranscriptRecord): string {
	const content = data.message?.content
	if (typeof content !== 'string' || !STOP_FEEDBACK_LABEL.test(content)) return ''

	return content.replace(STOP_FEEDBACK_LABEL, '').trim()
}

// The two fields read off `message`, taken together because they are one reading: an assistant turn
// is written as one line per content block with the message's id repeated on each, so the id is what
// says which blocks belonged to the same turn.
function message_fields(
	message: TranscriptMessage | null | undefined,
): Pick<TranscriptLine, 'message_id' | 'blocks'> {
	return {
		message_id: message?.id ?? NO_MESSAGE_ID,
		blocks: time_transcript_block.to_blocks(message?.content),
	}
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

function request_fields(data: TranscriptRecord): Pick<TranscriptLine, 'request_id' | 'effort'> {
	return { request_id: data.requestId ?? '', effort: data.effort ?? '' }
}

// A line without a parseable timestamp is dropped rather than dated: it has no place on a timeline,
// and inventing one would move every span around it.
function to_line(data: TranscriptRecord): TranscriptLine | undefined {
	const timestamp_ms = time_instant.parse_instant(data.timestamp)

	if (timestamp_ms === undefined) return undefined

	const stop_feedback = stop_feedback_of(data)

	return {
		type: data.type ?? '',
		timestamp_ms,
		branch: data.gitBranch ?? UNKNOWN_BRANCH,
		finished_background: finished_background(data),
		stop_feedback,
		stop_guard: time_transcript_block.guard_from_refusal(stop_feedback),
		...request_fields(data),
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
	ERROR_TEXT_LIMIT: time_transcript_block.ERROR_TEXT_LIMIT,
	NO_MESSAGE_ID,
	TOKEN_LINE_LIMIT: time_transcript_block.TOKEN_LINE_LIMIT,
	guard_from_refusal: time_transcript_block.guard_from_refusal,
	parse_line,
	parse_text,
	refusal_body: time_transcript_block.refusal_body,
}

export type { TranscriptLine }
export { time_transcript_line }

export type { Block } from './time-transcript-block'
