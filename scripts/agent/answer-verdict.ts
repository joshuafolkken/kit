import type { IssueSource } from '#scripts/issue/issue-sources'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// **Whether an Issue already answers a question, as one contract every caller shares** — the park that
// refuses an answered question and the package scout that reuses existing code read the same verdict.
// An answered verdict stands only on quotes found verbatim in a fetched trusted source; anything else
// is a failure with its cause, never read as "answered" or "unanswered". The caller does its own
// writes: this module validates and returns.

const NON_BLANK = /\S/u
const TEXT_SCHEMA = z.string().regex(NON_BLANK)
const QUOTE_SCHEMA = z.strictObject({ source: TEXT_SCHEMA, text: TEXT_SCHEMA })
const ANSWERED_SCHEMA = z.strictObject({
	verdict: z.literal('answered'),
	decision: TEXT_SCHEMA,
	decision_kind: z.enum(['choice', 'reuse']),
	quotes: z.array(QUOTE_SCHEMA).min(1),
})
const UNANSWERED_SCHEMA = z.strictObject({ verdict: z.literal('unanswered'), reason: TEXT_SCHEMA })
const VERDICT_SCHEMA = z.discriminatedUnion('verdict', [ANSWERED_SCHEMA, UNANSWERED_SCHEMA])
const RETRY =
	'Re-run the same command: the judgment is launched again on the Issue as it reads now.'

type Answered = z.infer<typeof ANSWERED_SCHEMA>
type ParsedVerdict = z.infer<typeof VERDICT_SCHEMA>
type DecisionKind = Answered['decision_kind']

interface Evidence {
	source: IssueSource
	quote: string
}

interface VerdictFailure {
	kind: 'failed'
	cause: string
	retry: string
}

type AnswerVerdict =
	| VerdictFailure
	| { kind: 'answered'; decision: string; decision_kind: DecisionKind; evidence: Array<Evidence> }
	| { kind: 'unanswered'; reason: string }

function failed(cause: string, retry: string = RETRY): VerdictFailure {
	return { kind: 'failed', cause, retry }
}

// A model may wrap its object in a fence or a sentence; the object is what lies between the braces.
function json_text(raw: string): string | undefined {
	const start = raw.indexOf('{')
	const end = raw.lastIndexOf('}')

	return start === -1 || end < start ? undefined : raw.slice(start, end + 1)
}

function issues_of(error: z.ZodError): string {
	return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
}

function parsed_of(raw: string): ParsedVerdict | VerdictFailure {
	const text = json_text(raw)
	const value = text === undefined ? undefined : json_value.parse_or_undefined(text)

	if (value === undefined) return failed('the judgment printed no JSON object')

	const result = VERDICT_SCHEMA.safeParse(value)

	return result.success
		? result.data
		: failed(`the judgment is off the contract — ${issues_of(result.error)}`)
}

// An untrusted text never reaches `sources`, so a quote naming one fails as a source never fetched.
function evidence_of(
	quote: Answered['quotes'][number],
	sources: ReadonlyArray<IssueSource>,
): Evidence | VerdictFailure {
	const source = sources.find((candidate) => candidate.id === quote.source)

	if (source === undefined) {
		return failed(`a quote cites ${quote.source}, which is not a fetched trusted source`)
	}

	if (!source.text.includes(quote.text)) {
		return failed(`a quote is not in ${quote.source} verbatim: ${quote.text}`)
	}

	return { source, quote: quote.text }
}

function answered(parsed: Answered, sources: ReadonlyArray<IssueSource>): AnswerVerdict {
	const evidence: Array<Evidence> = []

	for (const quote of parsed.quotes) {
		const found = evidence_of(quote, sources)

		if ('kind' in found) return found
		evidence.push(found)
	}

	return {
		kind: 'answered',
		decision: parsed.decision,
		decision_kind: parsed.decision_kind,
		evidence,
	}
}

function validate(raw: string, sources: ReadonlyArray<IssueSource>): AnswerVerdict {
	const parsed = parsed_of(raw)

	if (!('verdict' in parsed)) return parsed
	if (parsed.verdict === 'unanswered') return { kind: 'unanswered', reason: parsed.reason }

	return answered(parsed, sources)
}

const answer_verdict = { RETRY, failed, validate }

export type { AnswerVerdict, DecisionKind, Evidence, VerdictFailure }
export { answer_verdict }
