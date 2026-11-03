import { guard_rephrase } from '#scripts/time-runtime/guard-rephrase'
import { time_transcript_line } from '#scripts/time-runtime/time-transcript-line'
import { delivered_rules, type MeasuredRule } from './delivered-rules'

// The refusals each delivered rule's guard drew that were rephrased into an allowed call — the
// false-positive proxy beside `josh rule:value`'s reading. The detector is the one guard-friction's
// `GuardRow.rephrased` reads (`guard-rephrase.ts`), so both name a rephrasing the same way; a rule is
// joined to its guard by the label its reason — or a former reason, under a renamed guard — opens with.

type RephraseCounts = Map<string, number>

function guards_of(rule: MeasuredRule): Array<string> {
	const reasons = [rule.reason, ...(rule.former_reasons ?? [])]

	return [...new Set(reasons.map((reason) => time_transcript_line.guard_from_refusal(reason)))]
}

const GUARDS_OF_RULE = new Map(
	delivered_rules.MEASURED_RULES.map((rule) => [rule.id, guards_of(rule)]),
)

function rephrased_in(text: string): Array<string> {
	return guard_rephrase.rephrased_guards(time_transcript_line.parse_text(text))
}

// Adds one run to `counts` for each guard any of its transcripts rephrased a refusal of — runs, the
// unit `refused` beside it counts in, so the column never reads as more rephrased refusals than refused runs.
function count_run(texts: ReadonlyArray<string>, counts: RephraseCounts): void {
	const guards = new Set(texts.flatMap((text) => rephrased_in(text)))

	for (const guard of guards) counts.set(guard, (counts.get(guard) ?? 0) + 1)
}

function rephrased_of(rule_id: string, counts: RephraseCounts): number {
	const guards = GUARDS_OF_RULE.get(rule_id) ?? []

	return guards.reduce((total, guard) => total + (counts.get(guard) ?? 0), 0)
}

const rule_rephrase = { count_run, rephrased_of }

export type { RephraseCounts }
export { rule_rephrase }
