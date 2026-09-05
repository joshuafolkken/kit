import { cost_blocks } from '#scripts/cost/cost-blocks'
import { json_value } from '#scripts/json-value'
import { z } from 'zod'
import { time_bundle_call } from './time-bundle-call'
import { time_instant } from './time-instant'
import { time_markers, type PhaseMarker } from './time-markers'
import { time_reported_failure } from './time-reported-failure'
import { time_shell } from './time-shell'

// Turning a session transcript into timed spans (joshuafolkken/kit#1267).
//
// `cost-*` reads the same files for what a run was billed. This reads the other axis: where its wall
// clock went. Discovery and reading are `cost-transcript.ts`'s and are reused rather than copied;
// what is here is the arithmetic, which has no counterpart on the cost side.
//
// **The block reader is not `cost-blocks.ts` and could not have been.** That module flattens every
// line into one list of blocks for a token estimate, dropping the `id` / `tool_use_id` pair a call
// is matched to its result by and the line boundary a timestamp belongs to. Both are the whole
// input here. Its three type constants are imported rather than restated.
//
// **The partition is by gap, not by pair.** Every span is the interval between two consecutive
// events, classified by the *later* one: a span ending at an assistant line is model wait, one
// ending at a tool result is that tool's execution, one ending at a user prompt is human wait.
// Classifying by pairs instead would double-count parallel tool calls and leave the three shares
// summing to something other than the elapsed time — the property that makes two runs comparable.
// Measured against the three sessions joshuafolkken/kit#1267 restored by hand: 49.6 / 73.3 / 54.6
// minutes, every share within 0.4 points of the hand figure.

const ASSISTANT_TYPE = 'assistant'
const USER_TYPE = 'user'
const UNKNOWN_TOOL = 'unknown'

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
// group by this field; counting one line's blocks answers one, whatever the turn actually did.
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

type SpanCategory = 'model' | 'tool' | 'human'

const MODEL_CATEGORY: SpanCategory = 'model'
const TOOL_CATEGORY: SpanCategory = 'tool'
const HUMAN_CATEGORY: SpanCategory = 'human'

// How the call this span paid for came back (joshuafolkken/kit#1309).
//
// **Three answers rather than two.** `unknown` is not a polite `ok`: a fifth of the tool results in
// the transcripts measured carry no `is_error` at all — a file read, an answered question — and
// folding those into `ok` would report a run as having failed nothing when nothing was read. It is
// also what a model span and a human span carry, since neither is a call and neither has an outcome
// to have.
type SpanOutcome = 'ok' | 'failed' | 'unknown'

const OK_OUTCOME: SpanOutcome = 'ok'
const FAILED_OUTCOME: SpanOutcome = 'failed'
const UNKNOWN_OUTCOME: SpanOutcome = 'unknown'

// What the result closing a span says about the call it belongs to, beyond the label read off the
// call itself. Two fields rather than one because both are answers about the *result* line and
// neither can be recovered from a span afterwards.
//
// **`call_id` is what makes two fragments of one call identifiable as one call.** A span bracketing a
// delegated unit comes back from `time_overlap.trim` as a head and a tail, and the two are told apart
// from a *different* call of the same tool only by this id — a label cannot do it, because two
// `Task` calls issued in the same turn share one.
interface ResultFacts {
	call_id: string
	outcome: SpanOutcome
}

const NO_RESULT: ResultFacts = { call_id: '', outcome: UNKNOWN_OUTCOME }

// What a tool span is labelled with. `josh_command` is empty for everything that is not a
// `pnpm josh <cmd>` invocation, and the report drops empty labels rather than printing a bucket.
//
// `marker` names the workflow boundary the call is, for the phase breakdown that slices the same
// spans by stage (joshuafolkken/kit#1269). It is carried here rather than re-derived later because
// the tool's *input* is what decides it, and a span keeps no input — only the label read off it.
//
// `is_bundleable` and `targets` are carried for exactly that reason too (joshuafolkken/kit#1344).
// Whether a call could have gone out beside another, and what it names, are both read off the input —
// so a module asking about them after the fact would have nothing to read. `time-bundle-call.ts`
// decides both; the rule each one follows is stated there.
interface ToolCall {
	label: string
	josh_command: string
	marker: PhaseMarker
	is_bundleable: boolean
	targets: ReadonlyArray<string>
}

const NO_CALL: ToolCall = {
	label: '',
	josh_command: '',
	marker: time_markers.NO_MARKER,
	...time_bundle_call.not_bundleable(),
}
const UNKNOWN_CALL: ToolCall = {
	label: UNKNOWN_TOOL,
	josh_command: '',
	marker: time_markers.NO_MARKER,
	...time_bundle_call.not_bundleable(),
}

// `ended_ms` is the absolute instant the span closed, so `[ended_ms - duration_ms, ended_ms]` is the
// interval it occupied. A duration alone cannot say *when*, and two things need that: the CI wait,
// which is the part of the PR-open→merge window no span covers (joshuafolkken/kit#1268), and the
// phase breakdown that slices the same array by boundary (joshuafolkken/kit#1269).
//
// `branch` rides along for the same reason `cost-usage.ts` carries it on a record: it is what
// `cost_attribute` reads to decide which issue the span belongs to.
// The two `ResultFacts` fields are carried for the same reason `marker` is: the result block is gone
// by the time anything aggregates, and only what was read off it survives.
interface Span extends ToolCall, ResultFacts {
	category: SpanCategory
	duration_ms: number
	ended_ms: number
	branch: string
	// Whether this span is the *remainder* of a call whose middle was given to a delegated unit, cut
	// out by `time_overlap.trim` (joshuafolkken/kit#1304). One call comes back as two spans there, so
	// anything counting calls rather than intervals has to skip the second — the round-trip block and
	// the per-tool table's `call_count` both do. Every span the transcript itself yields is `false`;
	// only the subtraction sets it.
	is_continuation: boolean
}

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

interface TimelineEvent extends ToolCall, ResultFacts {
	timestamp_ms: number
	branch: string
	category: SpanCategory
}

// The whole session: when it started, when it ended, and what it spent the interval on.
interface Timeline {
	started_ms: number
	ended_ms: number
	spans: Array<Span>
}

function to_tool_call(name: string, input: unknown): ToolCall {
	if (name !== cost_blocks.BASH_TOOL) {
		return {
			label: name,
			josh_command: '',
			marker: time_markers.tool_marker(name, input),
			...time_bundle_call.tool_facts(name, input),
		}
	}

	const command = time_shell.bash_command(input)

	return {
		label: time_shell.bash_label(command),
		josh_command: time_shell.josh_command_of(command),
		marker: time_markers.bash_marker(command),
		...time_bundle_call.bash_facts(command),
	}
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

function to_block(raw: z.infer<typeof BLOCK_SCHEMA>): Block {
	return {
		...block_names(raw),
		input: raw.input,
		is_error: raw.is_error ?? undefined,
		has_failure_line: time_reported_failure.has_failure_line(raw.content),
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

// Identified calls only. A `tool_use` written without an `id` would otherwise be registered under
// the empty string, where the next result that carries no `tool_use_id` would match it and be
// labelled with an unrelated tool — a wrong name where `UNKNOWN_TOOL` is the honest one.
function tool_use_blocks(lines: ReadonlyArray<TranscriptLine>): Array<Block> {
	return lines.flatMap((line) =>
		line.blocks.filter((block) => block.type === cost_blocks.TOOL_USE_TYPE && block.id !== ''),
	)
}

// Every call in the session, keyed by the id its result carries back. Built over the whole file
// first because a result can arrive many lines after the call that issued it.
function collect_calls(lines: ReadonlyArray<TranscriptLine>): Map<string, ToolCall> {
	return new Map(
		tool_use_blocks(lines).map((block) => [block.id, to_tool_call(block.name, block.input)]),
	)
}

// The first result on the line names the span. Claude Code writes one result per line, so this is
// the whole of it in practice; were it ever to write several, the gap would be charged to the first
// of them rather than divided — the three-way split stays exact either way, and only the per-tool
// table would be approximate.
function result_block(line: TranscriptLine): Block | undefined {
	return line.blocks.find((block) => block.type === cost_blocks.TOOL_RESULT_TYPE)
}

// One line's contribution to the timeline, with the two fields every event carries read from the
// line in one place. Written once rather than spelled out at each of the three return sites, which
// is what let `branch` be added without a fourth chance to forget it.
function event_of(
	line: TranscriptLine,
	category: SpanCategory,
	call: ToolCall,
	result: ResultFacts = NO_RESULT,
): TimelineEvent {
	return { timestamp_ms: line.timestamp_ms, branch: line.branch, category, ...result, ...call }
}

// A result that carried no `is_error` is `unknown` rather than `ok`: the tools that report no
// outcome — a file read, an answered question — would otherwise be counted as calls that succeeded,
// and a run whose whole transcript was written by them would report a measured zero failures.
//
// **What the command said outranks what the harness recorded, in one direction only**
// (joshuafolkken/kit#1361). A josh check run inside a pipeline exits with the pipe's status, so the
// harness writes `is_error: false` over a red gate; the failure line the command printed is the only
// surviving evidence, and it is read *before* the field. The reverse never happens — a call the
// harness marked failed is failed whatever it printed.
function outcome_of(result: Block, call: ToolCall): SpanOutcome {
	if (time_reported_failure.is_reported_failure(call.josh_command, result.has_failure_line)) {
		return FAILED_OUTCOME
	}

	if (result.is_error === undefined) return UNKNOWN_OUTCOME

	return result.is_error ? FAILED_OUTCOME : OK_OUTCOME
}

function facts_of(result: Block, call: ToolCall): ResultFacts {
	return { call_id: result.result_id, outcome: outcome_of(result, call) }
}

// A user line is one of two things, and only its blocks tell them apart: a tool result the harness
// wrote back, or a person typing.
function user_event(line: TranscriptLine, calls: ReadonlyMap<string, ToolCall>): TimelineEvent {
	const result = result_block(line)

	if (result === undefined) return event_of(line, HUMAN_CATEGORY, NO_CALL)

	const call = calls.get(result.result_id) ?? UNKNOWN_CALL

	return event_of(line, TOOL_CATEGORY, call, facts_of(result, call))
}

function to_event(
	line: TranscriptLine,
	calls: ReadonlyMap<string, ToolCall>,
): TimelineEvent | undefined {
	if (line.type === ASSISTANT_TYPE) return event_of(line, MODEL_CATEGORY, NO_CALL)

	return line.type === USER_TYPE ? user_event(line, calls) : undefined
}

// Sorted rather than trusted in file order. Claude Code writes a few lines microseconds out of
// order, and an unsorted walk turns those into negative durations — clamping them would break the
// one property this partition has, that the shares add up to the elapsed time.
function to_events(
	lines: ReadonlyArray<TranscriptLine>,
	calls: ReadonlyMap<string, ToolCall>,
): Array<TimelineEvent> {
	return lines
		.map((line) => to_event(line, calls))
		.filter((event): event is TimelineEvent => event !== undefined)
		.toSorted((left, right) => left.timestamp_ms - right.timestamp_ms)
}

// The span is named by the event that *closes* it, so the branch is that event's too: the work the
// interval paid for is the work the later line records, and taking the opening line's branch would
// attribute the first span after a `josh git` to whatever preceded the branch.
function to_spans(events: ReadonlyArray<TimelineEvent>): Array<Span> {
	return events.slice(1).map((event, index) => ({
		category: event.category,
		label: event.label,
		josh_command: event.josh_command,
		marker: event.marker,
		is_bundleable: event.is_bundleable,
		targets: event.targets,
		branch: event.branch,
		call_id: event.call_id,
		outcome: event.outcome,
		is_continuation: false,
		ended_ms: event.timestamp_ms,
		duration_ms: event.timestamp_ms - (events[index]?.timestamp_ms ?? event.timestamp_ms),
	}))
}

function parse_timeline(text: string): Timeline {
	const lines = text
		.split('\n')
		.map((line) => parse_line(line))
		.filter((line): line is TranscriptLine => line !== undefined)
	const events = to_events(lines, collect_calls(lines))

	return {
		started_ms: events[0]?.timestamp_ms ?? 0,
		ended_ms: events.at(-1)?.timestamp_ms ?? 0,
		spans: to_spans(events),
	}
}

// **"No span was read" is the one criterion every scope withholds a transcript figure on**
// (joshuafolkken/kit#1295). A run whose transcript could not be attributed, a child of an epic in
// that state, and a batch no child contributed to are the same fact asked at three scales, and each
// used to spell it out for itself — which is how the run scope came to print three `0.0 min` rows
// beside the epic scope's `not measured` for the very same child.
//
// It takes the count rather than the array so the three callers can pass what they hold: the spans
// themselves before a report exists, and `TimeReport.span_count` afterwards.
function has_transcript_data(span_count: number): boolean {
	return span_count > 0
}

const time_spans = {
	ASSISTANT_TYPE,
	MODEL_CATEGORY,
	TOOL_CATEGORY,
	HUMAN_CATEGORY,
	OK_OUTCOME,
	FAILED_OUTCOME,
	UNKNOWN_OUTCOME,
	NO_MESSAGE_ID,
	UNKNOWN_TOOL,
	has_transcript_data,
	// Re-exported so the suites that measure how a command is read keep asking one namespace, and so
	// `time-shell.ts` moving out of this file changed no call site (joshuafolkken/kit#1344).
	bash_label: time_shell.bash_label,
	josh_command_of: time_shell.josh_command_of,
	parse_line,
	parse_timeline,
}

export type { Block, ResultFacts, Span, SpanCategory, SpanOutcome, Timeline, TranscriptLine }
export { time_spans }
