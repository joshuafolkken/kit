import { behavior_change_lint } from './behavior-change-lint'
import {
	BUG_LABEL,
	BUGFIX_LABEL,
	ENHANCEMENT_LABEL,
	has_label_name,
	INTERRUPT_ROUTE_LABEL,
} from './issue-labels'
import { markdown_section } from './markdown-section'

// The defect rate of merged work over a window: issues filed as defects
// divided by enhancements completed. Both sides are read from labels and the defect declaration line,
// so nothing here asks for a judgement.

// A body declares itself a defect with this exact line, the sibling of the behavior-change declaration.
// Older bodies rarely wrote it, so the labels a maintainer re-applied after review count as well — the
// name changed over time (`bugfix` earlier, `bug` from `issue:file`), and the labels read both periods
// by one standard where the declaration alone moved the rate with the filing habit.
const DEFECT_DECLARATION_LINE = '- 種別: 不具合'
const DEFECT_LABELS: ReadonlyArray<string> = [BUG_LABEL, BUGFIX_LABEL, INTERRUPT_ROUTE_LABEL]
const DEFAULT_WINDOW_DAYS = 14
// The rate over 2026-09-09 to 2026-09-23 measured by the label definition — 150 / 206, rounded.
// `backlog:next` defers new mechanisms while the current rate is above it.
const BASELINE_RATE = 0.73
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
	enhancements: number
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

// Narrowed to the denominator's label, so the search pages only through what is counted.
function completed_query(repo: string, since: string): string {
	return `repo:${repo} is:issue is:closed reason:completed label:${ENHANCEMENT_LABEL} closed:>=${since}`
}

function is_defect(issue: RateIssue): boolean {
	return (
		markdown_section.has_line(issue.body, DEFECT_DECLARATION_LINE) ||
		DEFECT_LABELS.some((label) => has_label_name(issue.labels, label))
	)
}

// The denominator is every enhancement, not only the behavior changes `backlog:next` defers: a count
// the priority itself shrinks would push the rate further up while it is above the baseline.
function is_enhancement(issue: RateIssue): boolean {
	return has_label_name(issue.labels, ENHANCEMENT_LABEL)
}

// A defect label or declaration wins over a behavior-change declaration, so an issue that is both
// counts as the fix it is.
function kind_of(issue: RateIssue): IssueKind {
	if (is_defect(issue)) return 'defect'

	return behavior_change_lint.is_target(issue.body) ? 'mechanism' : 'other'
}

function measure(input: DefectRateInput): DefectRate {
	return {
		days: input.days,
		since: input.since,
		defects: input.filed.filter((issue) => is_defect(issue)).length,
		enhancements: input.completed.filter((issue) => is_enhancement(issue)).length,
		is_capped: input.is_capped,
	}
}

// Undefined when no enhancement completed in the window: a rate over zero is no answer, and printing
// 0 or Infinity would read as one.
function rate_of(result: DefectRate): number | undefined {
	if (result.enhancements === 0) return undefined

	return result.defects / result.enhancements
}

// Strictly above: a rate equal to the baseline has not risen, and a window with no rate is no answer.
function is_above_baseline(result: DefectRate): boolean {
	const rate = rate_of(result)

	return rate !== undefined && rate > BASELINE_RATE
}

function rate_text(result: DefectRate): string {
	const rate = rate_of(result)

	if (rate === undefined) return 'n/a (no enhancement completed in the window)'

	return `${rate.toFixed(RATE_DIGITS)} (${String(result.defects)} / ${String(result.enhancements)})`
}

function format(result: DefectRate): ReadonlyArray<string> {
	const lines = [
		`Defect rate over the last ${String(result.days)} days (since ${result.since}): ${rate_text(result)}`,
		`  Defects filed: ${String(result.defects)} — labelled ${DEFECT_LABELS.join(' / ')} or declared \`${DEFECT_DECLARATION_LINE}\``,
		`  Enhancements completed: ${String(result.enhancements)} — labelled ${ENHANCEMENT_LABEL}, closed as completed`,
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
	is_defect,
	kind_of,
	measure,
	rate_of,
	rate_text,
	window_start,
}

export type { DefectRate, DefectRateInput, IssueKind, RateIssue }
export { defect_rate }
