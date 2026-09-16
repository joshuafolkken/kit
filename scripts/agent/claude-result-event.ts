import { z } from 'zod'

const RESULT_EVENT_SCHEMA = z.looseObject({
	type: z.literal('result'),
	is_error: z.unknown().optional(),
	subtype: z.unknown().optional(),
	result: z.unknown().optional(),
	usage: z.unknown().optional(),
})
const USAGE_SCHEMA = z.looseObject({
	input_tokens: z.unknown().optional(),
	cache_read_input_tokens: z.unknown().optional(),
	output_tokens: z.unknown().optional(),
})

interface ClaudeResultEvent {
	is_error: boolean
	reason: string | undefined
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

function token_count(value: unknown): number | undefined {
	return typeof value === 'number' ? value : undefined
}

function usage_of(value: unknown): ClaudeResultEvent['usage'] {
	const parsed = USAGE_SCHEMA.safeParse(value)
	if (!parsed.success) return undefined
	const usage = {
		input_tokens: token_count(parsed.data.input_tokens),
		cached_input_tokens: token_count(parsed.data.cache_read_input_tokens),
		output_tokens: token_count(parsed.data.output_tokens),
	}

	return Object.values(usage).some((count) => count !== undefined) ? usage : undefined
}

function decode(value: unknown): ClaudeResultEvent | undefined {
	const parsed = RESULT_EVENT_SCHEMA.safeParse(value)
	if (!parsed.success) return undefined
	const is_error = parsed.data.is_error === true

	return {
		is_error,
		reason: is_error
			? (usable_reason(parsed.data.result) ?? usable_reason(parsed.data.subtype))
			: undefined,
		usage: usage_of(parsed.data.usage),
	}
}

const claude_result_event = { decode }

export type { ClaudeResultEvent }
export { claude_result_event }
