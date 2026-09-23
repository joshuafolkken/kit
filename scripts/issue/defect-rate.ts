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
	DEFAULT_WINDOW_DAYS,
	DEFECT_DECLARATION_LINE,
	completed_query,
	filed_query,
	format,
	is_behavior_change,
	is_defect,
	measure,
	rate_of,
	window_start,
}

export type { DefectRate, DefectRateInput, RateIssue }
export { defect_rate }
