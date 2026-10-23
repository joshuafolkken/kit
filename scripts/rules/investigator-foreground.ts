import { delegation_policy } from '#scripts/delegation/delegation-policy'
import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'
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

const INVESTIGATOR_FOREGROUND_REASON =
	'⛔ investigator foreground: a background `investigator` leaves its result queued until a later turn. ' +
	'Reissue the call with `run_in_background: false`, and put the reads of files this run will edit in the same message. ' +
	'It fires on every occurrence (`.claude/skills/workflow-commands/delegation.md`).'

const ROW = {
	id: 'investigator-foreground',
	is_trigger: is_background_investigator,
	reason: INVESTIGATOR_FOREGROUND_REASON,
	decide: (): boolean => true,
	keeps: keeps_foreground,
	reaches: is_investigator,
	about: {
		title: 'Investigator dispatched in the foreground',
		topic:
			'`.claude/skills/workflow-commands/delegation.md` → "The pre-implementation reading — what goes to a unit, and from which file"',
		fires:
			'an `Agent` / `Task` call of the `investigator` type without `run_in_background: false`. Every occurrence',
		quiet: 'another agent type, or `run_in_background: false` set',
	},
}

const investigator_foreground = { INVESTIGATOR_FOREGROUND_REASON, ROW, is_background_investigator }

export { investigator_foreground }
