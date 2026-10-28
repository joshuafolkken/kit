import { delivered_rules, type MeasuredRule } from './delivered-rules'
import type { RuleReading } from './rule-value'

// The rules `rule:value`'s reading says can go or shrink — the evidence
// `prompts/collaboration-workflow/residency.md` lets a retirement or a condensation rest on. **It lists, never removes**: each candidate is retired or condensed in an
// Issue of its own, or kept with a recorded reason.
//
// - **Retire**: no run reached the rule, over a window large enough for "never" to mean something.
//   Below it nothing is judged, since a fresh checkout reaches no rule at all. **Measurable rows
//   only**: an unmeasured row's trigger is the violation itself, so its `reached 0` says the rule was
//   never broken — the guard working — not that its situation never arose. A measurable row's trigger
//   is a neutral act or it declares `reaches` (`rule-value.ts`, `RuleReading.sessions`).
// - **Condense**: the hook refuses the rule on every occurrence (`decide`) and has refused it at least
//   once, so the prose need only point at the row — the hook, not the text, keeps it.

// The one threshold: the runs a reading must cover before a rule no run reached is a retirement
// candidate.
const MIN_RUNS_FOR_RETIREMENT = 20
const SEPARATOR = ', '
const NONE = 'none'

interface RuleCandidates {
	retire: ReadonlyArray<string>
	condense: ReadonlyArray<string>
}

function retire_candidates(readings: ReadonlyArray<RuleReading>, runs: number): Array<string> {
	if (runs < MIN_RUNS_FOR_RETIREMENT) return []

	return readings
		.filter((reading) => reading.is_measurable && reading.sessions === 0)
		.map((reading) => reading.id)
}

function is_enforced_on_every_occurrence(id: string, rules: ReadonlyArray<MeasuredRule>): boolean {
	return rules.some((rule) => rule.id === id && rule.decide !== undefined)
}

function condense_candidates(
	readings: ReadonlyArray<RuleReading>,
	rules: ReadonlyArray<MeasuredRule> = delivered_rules.MEASURED_RULES,
): Array<string> {
	return readings
		.filter((reading) => reading.refusals > 0)
		.filter((reading) => is_enforced_on_every_occurrence(reading.id, rules))
		.map((reading) => reading.id)
}

function judge(
	readings: ReadonlyArray<RuleReading>,
	runs: number,
	rules: ReadonlyArray<MeasuredRule> = delivered_rules.MEASURED_RULES,
): RuleCandidates {
	return {
		retire: retire_candidates(readings, runs),
		condense: condense_candidates(readings, rules),
	}
}

function listed(ids: ReadonlyArray<string>): string {
	return ids.length === 0 ? NONE : ids.join(SEPARATOR)
}

function render(candidates: RuleCandidates, runs: number): string {
	const window = `${runs.toString()} runs, threshold ${MIN_RUNS_FOR_RETIREMENT.toString()}`

	return [
		'candidates:',
		`  retire (reached 0; ${window}): ${listed(candidates.retire)}`,
		`  condense (refused on every occurrence by its hook): ${listed(candidates.condense)}`,
	].join('\n')
}

const rule_value_candidates = {
	condense_candidates,
	judge,
	render,
	retire_candidates,
	MIN_RUNS_FOR_RETIREMENT,
	NONE,
}

export type { RuleCandidates }
export { rule_value_candidates }
