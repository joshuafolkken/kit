import { delegation_policy } from '#scripts/delegation/delegation-policy'
import { hook_decision, type GuardRun } from '#scripts/josh/hook-decision'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import {
	time_transcript_line,
	type Block,
	type TranscriptLine,
} from '#scripts/time-runtime/time-transcript-line'
import { agent_model } from './agent-model'
import { implementation_cut } from './implementation-cut'

// An `investigator` dispatched without `run_in_background: false` is refused until it names it
// (joshuafolkken/kit#4721).
//
// **The background launch is the cost, not the dispatch.** The subagent tool launches in the
// background by default, so a main line with nothing else to do ends its turn on "waiting for the
// reply", and the finished result sits in the queue until a later turn — measured at 4 of 33 such
// dispatches over 7 days, 658 seconds idle, up to 287 in one plan. A foreground dispatch returns the
// result in the same turn; the edit-target reads that keep the main line busy go in the same message,
// where they run beside it.
//
// **It fires on every occurrence**: the remedy is one field on the same call.
//
// **A build whose subagent tool has no such field stands it down** (joshuafolkken/kit#4889). Claude
// Code 2.1.306 in VS Code declares no `run_in_background`: every dispatch there launched in the
// background (64 of 64), the model wrote the field as the string `"false"`, and the parsed hook input
// dropped it — so the refusal could never be met, and it blocked the very delegation the investigation
// guard demands. A string value is the tell: across 1,700 dispatches in builds that declare the field
// the model wrote a boolean every time. A first call written bare leaves no string anywhere, so the
// reissue it was refused into passes on the refused call's body instead (joshuafolkken/kit#4903).
//
// **The build is a fact of the session, not of the tail** (joshuafolkken/kit#4966). Each tell is
// recorded once against the transcript, so a stand-down outlives the 256 KiB window the tells are read
// from. A boolean `false` the parsed input dropped is a tell too: the transcript keeps what the model
// wrote, so a dispatch this row refused that wrote it there is one the field never reached.
//
// **This row's own refusal is the last tell** (joshuafolkken/kit#5148). The harness drops an undeclared
// argument before both the hook and the transcript see it, so a reissue rewritten after the refusal
// leaves no tell on the tail. A reissue that still carries no field passes, and is remembered for the
// session, when the last answered investigator dispatch on the tail is this row's refusal, alone in its
// message and inside the refusal-then-reissue window. A sibling of the refused call shares its message,
// a dispatch after an answered reissue follows a call that ran, and one past the window is a new one —
// each still refused where the build declares the field.

const INVESTIGATOR_FOREGROUND_REASON =
	'⛔ investigator foreground: a background `investigator` leaves its result queued until a later turn. ' +
	'Reissue the call with `run_in_background: false`, and put the reads of files this run will edit in the same message. ' +
	'It fires on every occurrence (`.claude/skills/workflow-commands/delegation.md`).'

const BACKGROUND_FIELD = 'run_in_background'
// The fields that make a reissue the same dispatch as the call it repeats.
const BODY_FIELDS = ['description', 'prompt'] as const
const GUARD_LABEL = time_transcript_line.guard_from_refusal(INVESTIGATOR_FOREGROUND_REASON)
const NO_FIELD_STAMP = hook_decision.create_refusal_stamp('josh-investigator-no-field-')

// `kit:investigator` is the consumer's spelling of the same definition.
function is_investigator(call: GuardedCall): boolean {
	if (!agent_model.SUBAGENT_TOOLS.has(call.name) || !json_value.is_record(call.input)) return false

	const type = call.input['subagent_type']

	return typeof type === 'string' && type.split(':').at(-1) === delegation_policy.INVESTIGATOR_AGENT
}

function field_of(input: unknown, key: string): unknown {
	return json_value.is_record(input) ? input[key] : undefined
}

function is_foreground(call: GuardedCall): boolean {
	return field_of(call.input, BACKGROUND_FIELD) === false
}

function is_background_investigator(call: GuardedCall): boolean {
	return is_investigator(call) && !is_foreground(call)
}

function keeps_foreground(call: GuardedCall): boolean {
	return is_investigator(call) && is_foreground(call)
}

function is_untyped_field(name: string, input: unknown): boolean {
	if (!agent_model.SUBAGENT_TOOLS.has(name) || !json_value.is_record(input)) return false

	return typeof input[BACKGROUND_FIELD] === 'string'
}

// The ids of the tail's calls that have a result, and of those this row refused with the refusal's
// instant.
interface TailResults {
	answered: ReadonlySet<string>
	refused: ReadonlyMap<string, number>
}

// A block with the message it was written in, or the instant its line was written.
interface Placed {
	block: Block
	message_id: string
	at_ms: number
}

function placed_of(lines: ReadonlyArray<TranscriptLine>): Array<Placed> {
	return lines.flatMap((line) =>
		line.blocks.map((block) => ({ block, message_id: line.message_id, at_ms: line.timestamp_ms })),
	)
}

function results_of(placed: ReadonlyArray<Placed>): TailResults {
	const results = placed.filter(({ block }) => block.result_id !== '')
	const refused = results.filter(({ block }) => block.refusal_guard === GUARD_LABEL)

	return {
		answered: new Set(results.map(({ block }) => block.result_id)),
		refused: new Map(refused.map(({ block, at_ms }) => [block.result_id, at_ms])),
	}
}

// The field written `false`, in either spelling.
function writes_foreground(block: Block): boolean {
	return String(field_of(block.input, BACKGROUND_FIELD)) === 'false'
}

function has_same_body(block: Block, call: GuardedCall): boolean {
	return BODY_FIELDS.every((key) => field_of(block.input, key) === field_of(call.input, key))
}

// The call in hand is not answered yet, and its `false` there is the one the parsed input dropped.
function is_pending_foreground(block: Block, results: TailResults): boolean {
	return !results.answered.has(block.id) && writes_foreground(block)
}

// The call in hand on the tail, or a dispatch this row refused that it repeats. A same-body dispatch
// that ran is not a tell: a build that declares the field still refuses a bare repeat of it past the
// reissue window `refuses` reads.
function is_same_dispatch(block: Block, call: GuardedCall, results: TailResults): boolean {
	if (!is_investigator(block) || !has_same_body(block, call)) return false

	return results.refused.has(block.id) || is_pending_foreground(block, results)
}

// A dispatch this row refused although it wrote the field `false`.
function is_dropped_foreground(block: Block, results: TailResults): boolean {
	return results.refused.has(block.id) && is_investigator(block) && writes_foreground(block)
}

function refused_at_ms(dispatch: Placed | undefined, results: TailResults): number {
	return results.refused.get(dispatch?.block.id ?? '') ?? hook_decision.NEVER_MS
}

function is_alone(dispatch: Placed, dispatches: ReadonlyArray<Placed>): boolean {
	return dispatches.filter(({ message_id }) => message_id === dispatch.message_id).length === 1
}

// The call in hand reissues this row's refusal: the last investigator dispatch with a result is one
// this row refused, alone in its message, within the reissue window. A sibling launched beside the
// refused call shares its message, and a dispatch after an answered reissue follows a call that ran.
function is_reissue(placed: ReadonlyArray<Placed>, results: TailResults, now_ms: number): boolean {
	const dispatches = placed.filter(({ block }) => is_investigator(block))
	const last = dispatches.findLast(({ block }) => results.answered.has(block.id))
	const at_ms = refused_at_ms(last, results)

	if (last === undefined || at_ms === hook_decision.NEVER_MS) return false

	return is_alone(last, dispatches) && now_ms - at_ms < implementation_cut.REISSUE_WINDOW_MS
}

function tail_shows_no_field(tail: string, call: GuardedCall, now_ms: number): boolean {
	const placed = placed_of(time_transcript_line.parse_text(tail))
	const results = results_of(placed)
	const has_block_tell = placed.some(
		({ block }) =>
			is_untyped_field(block.name, block.input) ||
			is_same_dispatch(block, call, results) ||
			is_dropped_foreground(block, results),
	)

	return has_block_tell || is_reissue(placed, results, now_ms)
}

function remember_no_field(run: GuardRun): boolean {
	NO_FIELD_STAMP.record(NO_FIELD_STAMP.path(run.transcript), run.now_ms)

	return true
}

function is_remembered(run: GuardRun): boolean {
	return NO_FIELD_STAMP.last_ms(NO_FIELD_STAMP.path(run.transcript)) !== hook_decision.NEVER_MS
}

// True when this session's subagent tool declares no `run_in_background`, so no dispatch in it can run
// in the foreground: the call in hand or a subagent call on the tail wrote the field as a string, the
// tail holds the call in hand (or the dispatch it reissues) with the field the parsed input dropped,
// or this row refused a dispatch that wrote it `false`. The first tell is recorded for the session. A
// call that names the background explicitly came through a build that declares the field.
function lacks_background_field(tail: string, call: GuardedCall, run: GuardRun): boolean {
	if (field_of(call.input, BACKGROUND_FIELD) === true) return false
	if (is_remembered(run)) return true

	const has_tell =
		is_untyped_field(call.name, call.input) || tail_shows_no_field(tail, call, run.now_ms)

	return has_tell && remember_no_field(run)
}

const ROW = {
	id: 'investigator-foreground',
	is_trigger: is_background_investigator,
	reason: INVESTIGATOR_FOREGROUND_REASON,
	already_satisfied: lacks_background_field,
	decide: (): boolean => true,
	keeps: keeps_foreground,
	reaches: is_investigator,
	about: {
		title: 'Investigator dispatched in the foreground',
		topic:
			'`.claude/skills/workflow-commands/delegation.md` → "The pre-implementation reading — what goes to a unit, and from which file"',
		fires:
			'an `Agent` / `Task` call of the `investigator` type without `run_in_background: false`. Every occurrence',
		quiet:
			'another agent type, `run_in_background: false` set, or a session whose subagent tool declares no `run_in_background` (the field written as a string, the tail holding the same description and prompt, a refused dispatch that wrote it `false`, or a reissue still without the field just after this row refused a lone dispatch) — remembered for the session',
	},
}

const investigator_foreground = {
	INVESTIGATOR_FOREGROUND_REASON,
	ROW,
	is_background_investigator,
	lacks_background_field,
}

export { investigator_foreground }
