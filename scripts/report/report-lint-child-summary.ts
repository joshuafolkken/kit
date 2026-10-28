import { report_format_reference } from './report-format-reference'
import { report_labels, type ReportLabels } from './report-labels'

// A lane child's closing summary carries only what GitHub does not, in a bounded length
// (`backlogrun-child.md` → "What the summary carries, and how long it may be"). This checks the half a
// machine can: the line bound, the cause / fix / result labels, and no changed-file list — a run of
// bullets that are a path and nothing else. What else belongs in it stays the writer's judgement.

// Two path-only bullets in a row already read as a list; one alone may be the one file a finding names.
const MIN_FILE_LIST_RUN = 2
const LIST_ITEM_PREFIX = /^\s*(?:\d+\.|[-*])\s+/u
const PATH_CHARACTERS = /^[\w.@/-]+$/u
const FILE_EXTENSION = /\.[a-z]+$/iu
const BACKTICK = '`'
// A label opens its line — after an optional list marker and bold marker — so a longer word ending
// in the label, or `Fix the parser` inside a sentence, does not stand in for a missing label.
const LABEL_LEAD = /^\s*(?:(?:\d+\.|[-*])\s+)?(?:\*\*)?/u
const LETTER_PATTERN = /^\p{L}/u

function content_lines(summary: string): ReadonlyArray<string> {
	return summary.split('\n').filter((line) => line.trim().length > 0)
}

function opens_with_label(line: string, label: string): boolean {
	const rest = line.replace(LABEL_LEAD, '')

	return rest.startsWith(label) && !LETTER_PATTERN.test(rest.slice(label.length))
}

// A bullet whose whole text, backticks aside, is one path — a slash segment or a file name.
function is_path_item(line: string): boolean {
	if (!LIST_ITEM_PREFIX.test(line)) return false

	const item = line.replace(LIST_ITEM_PREFIX, '').replaceAll(BACKTICK, '').trim()

	return PATH_CHARACTERS.test(item) && (item.includes('/') || FILE_EXTENSION.test(item))
}

function path_item_runs(lines: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<string>> {
	const runs: Array<Array<string>> = [[]]

	for (const line of lines) {
		if (is_path_item(line)) runs.at(-1)?.push(line)
		else runs.push([])
	}

	return runs.filter((run) => run.length >= MIN_FILE_LIST_RUN)
}

function length_violation(lines: ReadonlyArray<string>): ReadonlyArray<string> {
	const max = report_labels.CHILD_SUMMARY_MAX_LINES
	if (lines.length <= max) return []

	return [`✖ ${String(lines.length)} lines — the summary holds at most ${String(max)}`]
}

function label_violations(
	lines: ReadonlyArray<string>,
	labels: ReportLabels,
): ReadonlyArray<string> {
	return [labels.cause, labels.fix, labels.result]
		.filter((label) => lines.every((line) => !opens_with_label(line, label)))
		.map((label) => `✖ missing label: ${label}`)
}

function file_list_violations(lines: ReadonlyArray<string>): ReadonlyArray<string> {
	return path_item_runs(lines).map(
		(run) =>
			`✖ changed-file list (${String(run.length)} path-only items) — GitHub carries it: ${run[0]?.trim() ?? ''}`,
	)
}

// Every violation, in a fixed order; an empty array is a clean summary.
function lint_child_summary(
	summary: string,
	labels: ReportLabels = report_labels.session_labels(),
): ReadonlyArray<string> {
	const lines = content_lines(summary)

	return [
		...length_violation(lines),
		...label_violations(lines, labels),
		...file_list_violations(lines),
	]
}

// The violations followed by one line naming where the summary's shape is written; a clean summary
// stays empty, so `ok` is still the only output of a pass.
function with_reference(violations: ReadonlyArray<string>): ReadonlyArray<string> {
	if (violations.length === 0) return violations

	return [...violations, `→ the shape: ${report_format_reference.child_summary_pointer()}`]
}

const report_lint_child_summary = { lint_child_summary, with_reference }

export { report_lint_child_summary }
