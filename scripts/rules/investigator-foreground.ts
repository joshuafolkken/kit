import { delegation_policy } from '#scripts/delegation/delegation-policy'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
import { time_transcript_line } from '#scripts/time-runtime/time-transcript-line'
import { agent_model } from './agent-model'

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
// the model wrote a boolean every time. The refused call is on the tail by the reissue, so the reissue
// passes.

// `kit:investigator` is the consumer's spelling of the same definition.
function is_investigator(call: GuardedCall): boolean {
	if (!agent_model.SUBAGENT_TOOLS.has(call.name) || !json_value.is_record(call.input)) return false

	const type = call.input['subagent_type']

	return typeof type === 'string' && type.split(':').at(-1) === delegation_policy.INVESTIGATOR_AGENT
}

function is_foreground(call: GuardedCall): boolean {
	return json_value.is_record(call.input) && call.input['run_in_background'] === false
}

function is_background_investigator(call: GuardedCall): boolean {
	return is_investigator(call) && !is_foreground(call)
}

function keeps_foreground(call: GuardedCall): boolean {
	return is_investigator(call) && is_foreground(call)
}

function is_untyped_field(name: string, input: unknown): boolean {
	if (!agent_model.SUBAGENT_TOOLS.has(name) || !json_value.is_record(input)) return false

	return typeof input['run_in_background'] === 'string'
}

// True when the call in hand or a subagent call on the tail wrote the field as a string — the tool
// declares no `run_in_background`, so no dispatch in this session can run in the foreground.
function lacks_background_field(tail: string, call: GuardedCall): boolean {
	if (is_untyped_field(call.name, call.input)) return true

	return time_transcript_line
		.parse_text(tail)
		.some((line) => line.blocks.some((block) => is_untyped_field(block.name, block.input)))
}

const INVESTIGATOR_FOREGROUND_REASON =
	'⛔ investigator foreground: a background `investigator` leaves its result queued until a later turn. ' +
	'Reissue the call with `run_in_background: false`, and put the reads of files this run will edit in the same message. ' +
	'It fires on every occurrence (`.claude/skills/workflow-commands/delegation.md`).'

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
			'another agent type, `run_in_background: false` set, or a subagent tool that declares no `run_in_background` (the field written as a string)',
	},
}

const investigator_foreground = {
	INVESTIGATOR_FOREGROUND_REASON,
	ROW,
	is_background_investigator,
	lacks_background_field,
}

export { investigator_foreground }
