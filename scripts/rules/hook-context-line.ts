import { json_value } from '#scripts/lib/json-value'

// The context a `PreToolUse` hook attached to a call, read off one transcript line.
// The harness writes a hook's `additionalContext` as an `attachment` line of
// this type, which is the only trace a rewritten call leaves: the call itself is recorded as it was
// typed, and no refusal comes back for it. `rule-value.ts` reads a rewrite's note from here so the
// rewrite is counted as the delivery it is.
const HOOK_CONTEXT_TYPE = 'hook_additional_context'

function strings_of(value: unknown): Array<string> {
	if (!Array.isArray(value)) return []

	return value.filter((one): one is string => typeof one === 'string')
}

// The substring test first, so the ordinary line is never parsed twice — `rule-value.ts` has already
// parsed every line once through `time_transcript_line`.
function hook_contexts_of(line: string): Array<string> {
	if (!line.includes(HOOK_CONTEXT_TYPE)) return []

	const parsed = json_value.parse_or_undefined(line)
	const attachment = json_value.is_record(parsed) ? parsed['attachment'] : undefined

	if (!json_value.is_record(attachment) || attachment['type'] !== HOOK_CONTEXT_TYPE) return []

	return strings_of(attachment['content'])
}

const hook_context_line = { HOOK_CONTEXT_TYPE, hook_contexts_of }

export { hook_context_line }
