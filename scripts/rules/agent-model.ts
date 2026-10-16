import { json_value } from '#scripts/lib/json-value'
import type { GuardedCall } from '#scripts/time-runtime/time-batch-guard'

// A `general-purpose` subagent dispatched without a `model` is refused until it names one
// (joshuafolkken/kit#3927).
//
// **The omission is the cost, not the dispatch.** A subagent with no `model` inherits the parent's,
// so a routine unit runs on the main line's model — measured at 94 such dispatches on Opus. A named
// agent type carries its own `model` in its definition, so only the catch-all type is in scope; an
// absent `subagent_type` is that type, the harness's default.
//
// **It fires on every occurrence**: the remedy is one field on the same call, so a refusal costs one
// round trip and never wedges the run.

// Both spellings of the subagent tool are in use: `Task` (published) and `Agent` (this harness).
const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task'])
const GENERAL_PURPOSE = 'general-purpose'

// A dispatch of the catch-all type — the one whose model is otherwise inherited.
function is_general_purpose(call: GuardedCall): boolean {
	if (!SUBAGENT_TOOLS.has(call.name) || !json_value.is_record(call.input)) return false

	const type = call.input['subagent_type']

	return type === undefined || type === GENERAL_PURPOSE
}

function names_model(call: GuardedCall): boolean {
	const model = json_value.is_record(call.input) ? call.input['model'] : undefined

	return typeof model === 'string' && model.length > 0
}

function is_unnamed_model(call: GuardedCall): boolean {
	return is_general_purpose(call) && !names_model(call)
}

function keeps_model(call: GuardedCall): boolean {
	return is_general_purpose(call) && names_model(call)
}

const AGENT_MODEL_REASON =
	'⛔ agent model: a `general-purpose` subagent with no `model` inherits the parent model. ' +
	'Reissue the call with `model` set — `sonnet` for routine work, `opus` for judgment such as a review. ' +
	'It fires on every occurrence (`.claude/skills/workflow-commands/delegation.md`).'

// `reaches` is every catch-all dispatch, so `rule-value.ts` scores the named-model ones against it.
const ROW = {
	id: 'agent-model',
	is_trigger: is_unnamed_model,
	reason: AGENT_MODEL_REASON,
	decide: (): boolean => true,
	keeps: keeps_model,
	reaches: is_general_purpose,
}

const agent_model = { AGENT_MODEL_REASON, ROW, is_unnamed_model }

export { agent_model }
