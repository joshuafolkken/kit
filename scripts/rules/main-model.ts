import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// The model the session's main line is answering on (joshuafolkken/kit#5351), read from the newest
// entry that names one: Claude Code writes it on each assistant entry, a Codex rollout on each turn's
// `turn_context`. A Codex payload naming the model wins over its transcript. `undefined` when nothing
// names it, so a rule keyed on the model stays silent rather than guessing.
//
// The tail handed to a hook inside a delegated unit is the unit's own transcript, so a subagent reads
// its own model here and never the parent's.

// Claude Code's placeholder for an entry no model produced (an API error, an interruption).
const SYNTHETIC_MODEL = '<synthetic>'

const named_model = z.object({ model: z.string() })
const entry_schema = z.union([
	z.object({ type: z.literal('assistant'), message: named_model }),
	z.object({ type: z.literal('turn_context'), payload: named_model }),
])

function model_of_line(line: string): string | undefined {
	const entry = json_value.parse_with(line, entry_schema)
	if (entry === undefined) return undefined
	const model = entry.type === 'assistant' ? entry.message.model : entry.payload.model

	return model === SYNTHETIC_MODEL ? undefined : model
}

// A tail starts mid-line, so its first line never parses and is skipped like any other non-entry.
function model_of_tail(tail: string): string | undefined {
	const lines = tail.split('\n')

	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const model = model_of_line(lines[index] ?? '')

		if (model !== undefined) return model
	}

	return undefined
}

// `recorded_model` is the one the session started on (`session-model-record.ts`), answered only when
// nothing newer names one — a first prompt, before any assistant entry (joshuafolkken/kit#5761).
function main_model(
	tail: string,
	payload_model: string | undefined,
	recorded_model?: string,
): string | undefined {
	return payload_model ?? model_of_tail(tail) ?? recorded_model
}

const main_model_reader = { main_model }

export { main_model_reader }
