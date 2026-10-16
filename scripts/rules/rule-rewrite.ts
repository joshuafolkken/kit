import { hook_decision } from '#scripts/josh/hook-decision'
import { json_value } from '#scripts/lib/json-value'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { time_hook_transcript } from '#scripts/time-runtime/time-hook-transcript'
import { delivered_rules, type DeliveredRule } from './delivered-rules'
import { guard_remedy } from './guard-remedy'

// The call a `PreToolUse` hook runs in place of a mechanically fixable refusal (joshuafolkken/kit#3920).
// Each row `guard-remedy.ts` classes as a rewrite gets the call in turn, so one line that both pipes a
// check and reads a body is made right by both rows. The rewrite is the rule guard's delivery, so the
// rule guard's switch turns it off too.

interface RuleRewrite {
	// The payload carrying the rewritten input, which the guards judge in place of the typed one.
	payload: string
	input: Record<string, unknown>
	// The notes of the rows that rewrote, in row order.
	note: string
}

interface Folded {
	input: Record<string, unknown>
	notes: ReadonlyArray<string>
}

const REWRITING_RULES: ReadonlyArray<DeliveredRule> = delivered_rules.DELIVERED_RULES.filter(
	(rule) => guard_remedy.is_rewrite(rule.id) && rule.rewrite !== undefined,
)

const NOTE_SEPARATOR = '\n\n'

// **A tail that cannot be read is an empty one**, as every guard fails open (`hook-decision.ts`): a
// throw here would end the hook before any guard judged the call.
function read_payload_tail(raw_payload: string): string {
	try {
		const payload = hook_decision.parse_hook_payload(raw_payload)

		return payload
			? time_density_hook.read_tail(
					time_hook_transcript.transcript_of(payload.transcript_path, payload.agent_id),
				)
			: ''
	} catch {
		return ''
	}
}

function tail_reader(raw_payload: string): () => string {
	const cache: { tail?: string } = {}

	return function tail(): string {
		cache.tail ??= read_payload_tail(raw_payload)

		return cache.tail
	}
}

function fold(name: string, typed: Record<string, unknown>, tail: () => string): Folded {
	const folded: Folded = { input: typed, notes: [] }

	for (const rule of REWRITING_RULES) {
		const input = rule.rewrite?.({ name, input: folded.input }, tail)

		if (input === undefined) {
			continue
		}

		folded.input = input
		folded.notes = [...folded.notes, rule.rewrite_note ?? '']
	}

	return folded
}

// The typed call, beside the whole payload its rewrite is spread back into.
interface TypedPayload {
	fields: Record<string, unknown>
	name: string
	input: Record<string, unknown>
}

function typed_payload(raw_payload: string): TypedPayload | undefined {
	const fields = json_value.parse_or_undefined(raw_payload)

	if (!json_value.is_record(fields)) return undefined

	const input = fields['tool_input']

	return json_value.is_record(input)
		? { fields, name: String(fields['tool_name']), input }
		: undefined
}

function rewrite(raw_payload: string): RuleRewrite | undefined {
	const typed = delivered_rules.is_enabled() ? typed_payload(raw_payload) : undefined

	if (typed === undefined) return undefined

	const { input, notes } = fold(typed.name, typed.input, tail_reader(raw_payload))

	if (notes.length === 0) return undefined

	const note = notes.join(NOTE_SEPARATOR)

	return { payload: JSON.stringify({ ...typed.fields, tool_input: input }), input, note }
}

const rule_rewrite = {
	NOTE_SEPARATOR,
	rewrite,
}

export type { RuleRewrite }
export { rule_rewrite }
