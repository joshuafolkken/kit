import { report_format_reference } from './report-format-reference'
import { report_labels, type ReportLabels } from './report-labels'

// The mechanical half of the two-layer work summary (`CLAUDE.md` Step 0, single-sourced in
// `prompts/collaboration-workflow/report-format.md`) is a fixed shape, yet only an advisory echo in
// the `UserPromptSubmit` hook ever mentions it and nothing reads the summary an agent actually
// wrote. This checks the half a machine can: the labels are present, the overview lines stay inside
// their length, nothing wraps the summary in a code fence, and no file path or CLI flag leaks into
// the overview. The judgement half — whether the subject is concrete — is deliberately left out,
// because a machine cannot answer it.

// The labels come from `report-labels.ts` in the session language — the same table
// `report:template` prints the skeleton from, so a skeleton it printed always passes.
const TEMPLATE_HEADING = report_format_reference.SUMMARY_TEMPLATE_HEADING

function required_labels(labels: ReportLabels): ReadonlyArray<string> {
	return [labels.overview, labels.now, labels.change, labels.check, labels.details, labels.changes]
}

// 80–100 chars is the guide; the ceiling is what a machine can enforce, so an overview sentence over
// this many characters is the violation and the lower bound stays the writer's judgement.
const MAX_OVERVIEW_CHARS = 100
const ITEM_LINE_PREFIX = '- '
// A file path (a slash segment, or a bare name with a source extension) or a long CLI flag — the
// internal identifiers `report-format.md` bans from the overview. A function or type name cannot be
// told from an ordinary word mechanically, so it is left to the judgement half.
const PATH_SEGMENT_PATTERN = /[\w-]\/[\w-]/u
const FILE_EXTENSION_PATTERN = /\.(?:ts|tsx|js|jsx|mjs|cjs|svelte|json|yaml|yml|css)\b/u
const CLI_FLAG_PATTERN = /(?:^|\s)--[a-z]/u
const BOLD_MARKER = '**'
const LEADING_LABEL_PUNCTUATION = /^[\s:：]+/u
const LETTER_PATTERN = /^\p{L}/u

// The case-based test declaration: the changes section carries a first tier
// of fixed-vocabulary cases — each non-applicable one crossed out with a reason — and a second tier
// of at-least-three "if it breaks" conditions. This checks the mechanical half: the two tier markers
// are present, an N/A cross-out carries a reason, and the second tier holds enough conditions (or the
// "never breaks" escape). Whether the cases are the right ones stays the judgement half.
const MIN_BREAK_CONDITIONS = 3
const LIST_ITEM_PATTERN = /^\s*(?:\d+\.|[-*])\s+/u
const REASON_SEPARATORS = /^[\s:：—|、,.。-]+/u

function first_content_line(summary: string): string {
	return (
		summary
			.split('\n')
			.find((line) => line.trim().length > 0)
			?.trim() ?? ''
	)
}

function is_fenced(summary: string): boolean {
	return first_content_line(summary).startsWith('```')
}

// A label counts only where no letter follows it, so `Change` is not found inside `Changes and tests`.
function has_label(summary: string, label: string): boolean {
	return summary
		.split(label)
		.slice(1)
		.some((rest) => !LETTER_PATTERN.test(rest))
}

function missing_labels(summary: string, labels: ReportLabels): ReadonlyArray<string> {
	return required_labels(labels).filter((label) => !has_label(summary, label))
}

function line_index_of(lines: ReadonlyArray<string>, label: string): number {
	return lines.findIndex((line) => line.includes(label))
}

// A section heading is a non-item line carrying the label, so an overview sentence that merely
// contains the word (`- **Now**: Details panel …`) does not end the region.
function heading_index_of(lines: ReadonlyArray<string>, label: string): number {
	return lines.findIndex((line) => !line.startsWith(ITEM_LINE_PREFIX) && line.includes(label))
}

// The overview region is the lines between the overview and details headings; the length and
// intrusion checks apply there alone, since the changes region legitimately carries file paths.
function overview_lines(summary: string, labels: ReportLabels): ReadonlyArray<string> {
	const lines = summary.split('\n')
	const start = line_index_of(lines, labels.overview)
	if (start < 0) return []

	const after = lines.slice(start + 1)
	const end = heading_index_of(after, labels.details)

	return (end < 0 ? after : after.slice(0, end)).filter((line) => line.startsWith(ITEM_LINE_PREFIX))
}

// The sentence after `- **label**: ` — the text past the first bold pair's closing marker, with the
// leading colon and spaces stripped. Only the label's own `**…**` is stripped, so inline emphasis
// later in the sentence stays inside the checked text; a line with no bold pair falls back to `- `.
function item_sentence(line: string): string {
	const open = line.indexOf(BOLD_MARKER)
	const close = open === -1 ? -1 : line.indexOf(BOLD_MARKER, open + BOLD_MARKER.length)
	const raw = line.slice(close === -1 ? ITEM_LINE_PREFIX.length : close + BOLD_MARKER.length)

	return raw.replace(LEADING_LABEL_PUNCTUATION, '').trim()
}

function overview_sentences(summary: string, labels: ReportLabels): ReadonlyArray<string> {
	return overview_lines(summary, labels).map((line) => item_sentence(line))
}

function has_path_or_flag(sentence: string): boolean {
	return (
		PATH_SEGMENT_PATTERN.test(sentence) ||
		FILE_EXTENSION_PATTERN.test(sentence) ||
		CLI_FLAG_PATTERN.test(sentence)
	)
}

function fence_violation(summary: string): ReadonlyArray<string> {
	return is_fenced(summary)
		? ['✖ the summary is wrapped in a code fence — write it as plain markdown']
		: []
}

function label_violations(summary: string, labels: ReportLabels): ReadonlyArray<string> {
	return missing_labels(summary, labels).map((label) => `✖ missing label: ${label}`)
}

function length_violations(summary: string, labels: ReportLabels): ReadonlyArray<string> {
	return overview_sentences(summary, labels)
		.filter((sentence) => sentence.length > MAX_OVERVIEW_CHARS)
		.map((sentence) => `✖ overview line over ${String(MAX_OVERVIEW_CHARS)} chars: ${sentence}`)
}

function intrusion_violations(summary: string, labels: ReportLabels): ReadonlyArray<string> {
	return overview_sentences(summary, labels)
		.filter((sentence) => has_path_or_flag(sentence))
		.map((sentence) => `✖ file path or CLI flag in the overview: ${sentence}`)
}

// The changes region is every line after the changes label; the case checks apply there, since the
// two tiers and their markers live under the changes section alone. A wholly missing section is
// already a missing label, so an empty region keeps one absence from printing as two violations.
function changes_region_lines(summary: string, labels: ReportLabels): ReadonlyArray<string> {
	const lines = summary.split('\n')
	const start = line_index_of(lines, labels.changes)

	return start < 0 ? [] : lines.slice(start + 1)
}

// The text after the N/A marker in a segment, with separators stripped — empty means no reason given.
function reason_after_na(segment: string, marker: string): string {
	return segment
		.slice(segment.indexOf(marker) + marker.length)
		.replace(REASON_SEPARATORS, '')
		.trim()
}

// Cases are listed on one line separated by `/`, so each N/A cross-out is checked in its own segment
// — a reasonless second cross-out on a line whose first one carries a reason must not escape.
function line_has_reasonless_na(line: string, marker: string): boolean {
	return line
		.split('/')
		.some((segment) => segment.includes(marker) && reason_after_na(segment, marker).length === 0)
}

function break_marker_index(lines: ReadonlyArray<string>, labels: ReportLabels): number {
	return lines.findIndex((line) => line.includes(labels.if_it_breaks))
}

// The count of list items after the second-tier marker. Over-counting a later change block's items
// only relaxes the check, never fires a false violation, so the simple whole-tail count is enough.
function break_condition_count(lines: ReadonlyArray<string>, labels: ReportLabels): number {
	const start = break_marker_index(lines, labels)
	if (start < 0) return 0

	return lines.slice(start + 1).filter((line) => LIST_ITEM_PATTERN.test(line)).length
}

function case_line_violations(summary: string, labels: ReportLabels): ReadonlyArray<string> {
	if (
		!summary.includes(labels.changes) ||
		changes_region_lines(summary, labels).some((line) => line.includes(labels.cases))
	) {
		return []
	}

	return [`✖ no case tier (${labels.cases}:) in ${labels.changes}`]
}

function na_reason_violations(summary: string, labels: ReportLabels): ReadonlyArray<string> {
	return changes_region_lines(summary, labels)
		.filter((line) => line_has_reasonless_na(line, labels.not_applicable))
		.map(() => `✖ ${labels.not_applicable} without a reason — say why the case does not apply`)
}

function break_violations(summary: string, labels: ReportLabels): ReadonlyArray<string> {
	if (!summary.includes(labels.changes)) return []

	const lines = changes_region_lines(summary, labels)
	if (lines.some((line) => line.includes(labels.never_breaks))) return []

	if (break_marker_index(lines, labels) < 0) {
		return [`✖ no ${labels.if_it_breaks} tier in ${labels.changes}`]
	}

	if (break_condition_count(lines, labels) >= MIN_BREAK_CONDITIONS) return []

	const needed = `${String(MIN_BREAK_CONDITIONS)} conditions or "${labels.never_breaks}"`

	return [`✖ ${labels.if_it_breaks} needs ${needed}`]
}

// Every violation the mechanical checks find, in a fixed order; an empty array is a clean summary.
function lint_report(
	summary: string,
	labels: ReportLabels = report_labels.session_labels(),
): ReadonlyArray<string> {
	return [
		...fence_violation(summary),
		...label_violations(summary, labels),
		...length_violations(summary, labels),
		...intrusion_violations(summary, labels),
		...case_line_violations(summary, labels),
		...na_reason_violations(summary, labels),
		...break_violations(summary, labels),
	]
}

// The violations followed by one line naming where the summary's shape is written
// — the violations say what is wrong, the pointer where the right shape is.
// A clean summary stays empty, so `ok` is still the only output of a pass.
function with_reference(violations: ReadonlyArray<string>): ReadonlyArray<string> {
	if (violations.length === 0) return violations

	return [...violations, `→ the template: ${report_format_reference.pointer(TEMPLATE_HEADING)}`]
}

const report_lint = {
	has_label,
	lint_report,
	with_reference,
	required_labels,
	MAX_OVERVIEW_CHARS,
	MIN_BREAK_CONDITIONS,
}

export { report_lint }
