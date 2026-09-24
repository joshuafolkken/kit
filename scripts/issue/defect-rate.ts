import { has_label_name, INTERRUPT_ROUTE_LABEL } from '#scripts/git/issue-labels'
import { behavior_change_lint } from './behavior-change-lint'
import { markdown_section } from './markdown-section'

// The defect rate of merged work over a window (joshuafolkken/kit#2449): issues filed as defects
// divided by behavior changes completed. Both sides are read from an issue-kind declaration line and
// the `route:interrupt` label, so nothing here asks for a judgement.

// A body declares itself a defect with this exact line, the sibling of the behavior-change declaration.
// Filers already write it, but the issue template does not list it yet and no filing lint enforces it,
// so a defect filed without it is counted only when it carries `route:interrupt`.
const DEFECT_DECLARATION_LINE = '- 種別: 不具合'
const DEFAULT_WINDOW_DAYS = 14
// The rate measured when the command was introduced — 20 / 48 over 2026-09-09 to 2026-09-23, recorded
// on joshuafolkken/kit#2449 as the rounded 0.42, which is the threshold that issue fixed. `backlog:next` defers new mechanisms while the current rate is above it
// (joshuafolkken/kit#2455).
const BASELINE_RATE = 0.42
const MS_PER_DAY = 86_400_000
const ISO_DATE_LENGTH = 10
const RATE_DIGITS = 2

interface RateIssue {
	body: string
	labels: ReadonlyArray<string>
}

interface DefectRate {
	days: number
	since: string
	defects: number
	behavior_changes: number
	is_capped: boolean
}

// What an issue is to the priority `backlog:next` gives while the rate is above the baseline: a defect
// (or hardening) goes first, a new mechanism is deferred, anything else keeps its place.
type IssueKind = 'defect' | 'mechanism' | 'other'

interface DefectRateInput {
	days: number
	since: string
	filed: ReadonlyArray<RateIssue>
	completed: ReadonlyArray<RateIssue>
	is_capped: boolean
}

// The first day of the window as `YYYY-MM-DD`, the spelling GitHub's `created:>=` / `closed:>=` read.
function window_start(now_ms: number, days: number): string {
	return new Date(now_ms - days * MS_PER_DAY).toISOString().slice(0, ISO_DATE_LENGTH)
}

function filed_query(repo: string, since: string): string {
	return `repo:${repo} is:issue created:>=${since}`
}

function completed_query(repo: string, since: string): string {
	return `repo:${repo} is:issue is:closed reason:completed closed:>=${since}`
}

function is_defect(issue: RateIssue): boolean {
	return (
		markdown_section.has_line(issue.body, DEFECT_DECLARATION_LINE) ||
		has_label_name(issue.labels, INTERRUPT_ROUTE_LABEL)
	)
}

function is_behavior_change(issue: RateIssue): boolean {
	return behavior_change_lint.is_target(issue.body)
}

// A defect declaration or `route:interrupt` wins over a behavior-change declaration, so an issue that
// is both counts as the fix it is.
function kind_of(issue: RateIssue): IssueKind {
	if (is_defect(issue)) return 'defect'

	return is_behavior_change(issue) ? 'mechanism' : 'other'
}

function measure(input: DefectRateInput): DefectRate {
	return {
		days: input.days,
		since: input.since,
		defects: input.filed.filter((issue) => is_defect(issue)).length,
		behavior_changes: input.completed.filter((issue) => is_behavior_change(issue)).length,
		is_capped: input.is_capped,
	}
}

// Undefined when no behavior change completed in the window: a rate over zero is no answer, and
// printing 0 or Infinity would read as one.
function rate_of(result: DefectRate): number | undefined {
	if (result.behavior_changes === 0) return undefined

	return result.defects / result.behavior_changes
}

// Strictly above: a rate equal to the baseline has not risen, and a window with no rate is no answer.
function is_above_baseline(result: DefectRate): boolean {
	const rate = rate_of(result)

	return rate !== undefined && rate > BASELINE_RATE
}

function rate_text(result: DefectRate): string {
	const rate = rate_of(result)

	if (rate === undefined) return 'n/a (no behavior change completed in the window)'

	return `${rate.toFixed(RATE_DIGITS)} (${String(result.defects)} / ${String(result.behavior_changes)})`
}

function format(result: DefectRate): ReadonlyArray<string> {
	const lines = [
		`Defect rate over the last ${String(result.days)} days (since ${result.since}): ${rate_text(result)}`,
		`  Defects filed: ${String(result.defects)} — declared \`${DEFECT_DECLARATION_LINE}\` or labelled ${INTERRUPT_ROUTE_LABEL}`,
		`  Behavior changes completed: ${String(result.behavior_changes)} — declared \`${behavior_change_lint.DECLARATION_LINE}\`, closed as completed`,
	]

	if (!result.is_capped) return lines

	return [
		...lines,
		'⚠ The search stopped before the end of the window; both counts are lower bounds.',
	]
}

const defect_rate = {
	BASELINE_RATE,
	DEFAULT_WINDOW_DAYS,
	DEFECT_DECLARATION_LINE,
	completed_query,
	filed_query,
	format,
	is_above_baseline,
	is_behavior_change,
	is_defect,
	kind_of,
	measure,
	rate_of,
	rate_text,
	window_start,
}

export type { DefectRate, DefectRateInput, IssueKind, RateIssue }
export { defect_rate }
