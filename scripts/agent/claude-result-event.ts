import { z } from 'zod'
import { interactive_ask } from './interactive-ask'

const RESULT_EVENT_SCHEMA = z.looseObject({
	type: z.literal('result'),
	is_error: z.unknown().optional(),
	subtype: z.unknown().optional(),
	num_turns: z.unknown().optional(),
	permission_denials: z.unknown().optional(),
	result: z.unknown().optional(),
	session_id: z.unknown().optional(),
	usage: z.unknown().optional(),
})
const USAGE_SCHEMA = z.looseObject({
	input_tokens: z.unknown().optional(),
	cache_read_input_tokens: z.unknown().optional(),
	output_tokens: z.unknown().optional(),
})

interface ClaudeResultEvent {
	is_error: boolean
	// The exit-record fields a supervisor classifies a dispatched lane child's ending from
	// (joshuafolkken/kit#2139). `subtype` and `num_turns` describe how the turn ended, and
	// `permission_denials` is the count of tool calls the harness refused — the direct cause of a child
	// that stopped mid-implementation without parking, so a classifier can name it in the park comment.
	subtype: string | undefined
	num_turns: number | undefined
	permission_denials: number
	// The refused interactive ask lifted out of `permission_denials` (joshuafolkken/kit#2201). Where a
	// child reached for `AskUserQuestion` and was refused, its question and options are stranded in the
	// exit record; `run:ending` puts them into the park comment so a person can answer, instead of the
	// parent opening the JSONL by hand. Undefined when no denial was an interactive ask.
	refused_ask: string | undefined
	reason: string | undefined
	// The Claude Code session identifier the `-p --output-format stream-json` run wrote on its result
	// event (joshuafolkken/kit#2317). An `outage` re-dispatch reads it to resume the disconnected child's
	// stored session — recovering its accumulated context — rather than starting a fresh `fullrun`.
	// Undefined when the event carried none, which sends the re-dispatch down the fresh fallback.
	session_id: string | undefined
	usage:
		| {
				input_tokens?: number | undefined
				cached_input_tokens?: number | undefined
				output_tokens?: number | undefined
		  }
		| undefined
}

function usable_reason(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function numeric_value(value: unknown): number | undefined {
	return typeof value === 'number' ? value : undefined
}

// A missing or malformed `permission_denials` counts as zero refusals rather than an unknown, so the
// classifier reads "no denials" the same way whether the harness omitted the field or wrote an empty
// array. It is the array's length, never its contents — the count is what the park comment carries.
function denial_count(value: unknown): number {
	return Array.isArray(value) ? value.length : 0
}

function usage_of(value: unknown): ClaudeResultEvent['usage'] {
	const parsed = USAGE_SCHEMA.safeParse(value)
	if (!parsed.success) return undefined
	const usage = {
		input_tokens: numeric_value(parsed.data.input_tokens),
		cached_input_tokens: numeric_value(parsed.data.cache_read_input_tokens),
		output_tokens: numeric_value(parsed.data.output_tokens),
	}

	return Object.values(usage).some((count) => count !== undefined) ? usage : undefined
}

function decode(value: unknown): ClaudeResultEvent | undefined {
	const parsed = RESULT_EVENT_SCHEMA.safeParse(value)
	if (!parsed.success) return undefined
	const is_error = parsed.data.is_error === true

	return {
		is_error,
		subtype: usable_reason(parsed.data.subtype),
		num_turns: numeric_value(parsed.data.num_turns),
		permission_denials: denial_count(parsed.data.permission_denials),
		refused_ask: interactive_ask.refused_ask_of(parsed.data.permission_denials),
		reason: is_error
			? (usable_reason(parsed.data.result) ?? usable_reason(parsed.data.subtype))
			: undefined,
		session_id: usable_reason(parsed.data.session_id),
		usage: usage_of(parsed.data.usage),
	}
}

const claude_result_event = { decode }

export type { ClaudeResultEvent }
export { claude_result_event }
