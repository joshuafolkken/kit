// The mechanical half of the two-layer work summary (`CLAUDE.md` Step 0, single-sourced in
// `prompts/collaboration-workflow/report-format.md`) is a fixed shape, yet only an advisory echo in
// the `UserPromptSubmit` hook ever mentions it and nothing reads the summary an agent actually
// wrote. This checks the half a machine can: the labels are present, the overview lines stay inside
// their length, nothing wraps the summary in a code fence, and no file path or CLI flag leaks into
// the overview. The judgement half — whether the subject is concrete — is deliberately left out,
// because a machine cannot answer it (joshuafolkken/kit#2123).

// The session-facing labels are Japanese because that is the form the summary is written in
// (`JOSH_SESSION_LANG` defaults to `ja`); `report-format.md`'s template is the single source and the
// document test pins that these match it.
const OVERVIEW_LABEL = '■ 概要'
const OVERVIEW_ITEM_LABELS = ['今こうなっている', 'こう直す', '確かめ方'] as const
const DETAILS_LABEL = '技術詳細'
const CHANGES_LABEL = '変更とテスト'
const REQUIRED_LABELS: ReadonlyArray<string> = [
	OVERVIEW_LABEL,
	...OVERVIEW_ITEM_LABELS,
	DETAILS_LABEL,
	CHANGES_LABEL,
]

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

// The case-based test declaration (joshuafolkken/kit#2246): the changes section carries a first tier
// of fixed-vocabulary cases — each non-applicable one crossed out with a reason — and a second tier
// of at-least-three "if it breaks" conditions. This checks the mechanical half: the two tier markers
// are present, an N/A cross-out carries a reason, and the second tier holds enough conditions (or the
// "never breaks" escape). Whether the cases are the right ones stays the judgement half.
// `report-format.md` is the single source and the document test pins these against it.
const CASE_LABEL = 'ケース'
const CASE_VOCABULARY: ReadonlyArray<string> = [
	'正常',
	'空・0件',
	'1件',
	'多数',
	'境界',
	'不正入力',
	'重複',
	'順序',
	'null',
]
const BREAK_LABEL = '壊れるとしたら'
const NA_LABEL = '該当なし'
const NO_BREAK_ESCAPE = 'どう呼ばれても壊れない'
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

function missing_labels(summary: string): ReadonlyArray<string> {
	return REQUIRED_LABELS.filter((label) => !summary.includes(label))
}

function line_index_of(lines: ReadonlyArray<string>, label: string): number {
	return lines.findIndex((line) => line.includes(label))
}

// The overview region is the lines between OVERVIEW_LABEL and DETAILS_LABEL; the length and intrusion
// checks apply there alone, since the CHANGES_LABEL region legitimately carries file paths.
function overview_lines(summary: string): ReadonlyArray<string> {
	const lines = summary.split('\n')
	const start = line_index_of(lines, OVERVIEW_LABEL)
	if (start < 0) return []

	const after = lines.slice(start + 1)
	const end = line_index_of(after, DETAILS_LABEL)

	return (end < 0 ? after : after.slice(0, end)).filter((line) => line.startsWith(ITEM_LINE_PREFIX))
}

// The sentence after `- **label**: ` — the text past the first bold pair's closing marker, with the
// leading colon and spaces stripped. Only the label's own `**…**` is stripped, so inline emphasis
// later in the sentence stays inside the checked text; a line with no bold pair falls back to `- `.
function item_sentence(line: string): string {
	const open = line.indexOf(BOLD_MARKER)
	const close = open === -1 ? -1 : line.indexOf(BOLD_MARKER, open + BOLD_MARKER.length)
	const raw =
		close === -1 ? line.slice(ITEM_LINE_PREFIX.length) : line.slice(close + BOLD_MARKER.length)

	return raw.replace(LEADING_LABEL_PUNCTUATION, '').trim()
}

function over_length_sentences(summary: string): ReadonlyArray<string> {
	return overview_lines(summary)
		.map((line) => item_sentence(line))
		.filter((sentence) => sentence.length > MAX_OVERVIEW_CHARS)
}

function has_path_or_flag(sentence: string): boolean {
	return (
		PATH_SEGMENT_PATTERN.test(sentence) ||
		FILE_EXTENSION_PATTERN.test(sentence) ||
		CLI_FLAG_PATTERN.test(sentence)
	)
}

function intruding_sentences(summary: string): ReadonlyArray<string> {
	return overview_lines(summary)
		.map((line) => item_sentence(line))
		.filter((sentence) => has_path_or_flag(sentence))
}

function fence_violation(summary: string): ReadonlyArray<string> {
	return is_fenced(summary)
		? ['✖ the summary is wrapped in a code fence — write it as plain markdown']
		: []
}

function label_violations(summary: string): ReadonlyArray<string> {
	return missing_labels(summary).map((label) => `✖ missing label: ${label}`)
}

function length_violations(summary: string): ReadonlyArray<string> {
	return over_length_sentences(summary).map(
		(sentence) => `✖ overview line over ${String(MAX_OVERVIEW_CHARS)} chars: ${sentence}`,
	)
}

function intrusion_violations(summary: string): ReadonlyArray<string> {
	return intruding_sentences(summary).map(
		(sentence) => `✖ file path or CLI flag in the overview: ${sentence}`,
	)
}

// The changes region is every line after CHANGES_LABEL; the case checks apply there, since the two
// tiers and their markers live under the changes section alone.
function changes_region_lines(summary: string): ReadonlyArray<string> {
	const lines = summary.split('\n')
	const start = line_index_of(lines, CHANGES_LABEL)

	return start < 0 ? [] : lines.slice(start + 1)
}

// The case checks run only when the section exists — a wholly missing section is already a missing
// label, so gating here keeps one absence from printing as two violations.
function has_changes_section(summary: string): boolean {
	return summary.includes(CHANGES_LABEL)
}

// The text after the N/A marker in a segment, with separators stripped — empty means no reason given.
function reason_after_na(segment: string): string {
	return segment
		.slice(segment.indexOf(NA_LABEL) + NA_LABEL.length)
		.replace(REASON_SEPARATORS, '')
		.trim()
}

// Cases are listed on one line separated by `/`, so each N/A cross-out is checked in its own segment
// — a reasonless second cross-out on a line whose first one carries a reason must not escape.
function line_has_reasonless_na(line: string): boolean {
	return line
		.split('/')
		.some((segment) => segment.includes(NA_LABEL) && reason_after_na(segment).length === 0)
}

function na_lines_without_reason(lines: ReadonlyArray<string>): ReadonlyArray<string> {
	return lines.filter((line) => line_has_reasonless_na(line))
}

function break_marker_index(lines: ReadonlyArray<string>): number {
	return lines.findIndex((line) => line.includes(BREAK_LABEL))
}

// The count of list items after the second-tier marker. Over-counting a later change block's items
// only relaxes the check, never fires a false violation, so the simple whole-tail count is enough.
function break_condition_count(lines: ReadonlyArray<string>): number {
	const start = break_marker_index(lines)
	if (start < 0) return 0

	return lines.slice(start + 1).filter((line) => LIST_ITEM_PATTERN.test(line)).length
}

function case_line_violations(summary: string): ReadonlyArray<string> {
	if (!has_changes_section(summary)) return []
	if (changes_region_lines(summary).some((line) => line.includes(CASE_LABEL))) return []

	return [`✖ no case tier (${CASE_LABEL}:) in ${CHANGES_LABEL}`]
}

function na_reason_violations(summary: string): ReadonlyArray<string> {
	if (!has_changes_section(summary)) return []

	return na_lines_without_reason(changes_region_lines(summary)).map(
		() => `✖ ${NA_LABEL} without a reason — say why the case does not apply`,
	)
}

function break_violations(summary: string): ReadonlyArray<string> {
	if (!has_changes_section(summary)) return []

	const lines = changes_region_lines(summary)
	if (lines.some((line) => line.includes(NO_BREAK_ESCAPE))) return []
	if (break_marker_index(lines) < 0) return [`✖ no ${BREAK_LABEL} tier in ${CHANGES_LABEL}`]
	if (break_condition_count(lines) >= MIN_BREAK_CONDITIONS) return []

	return [
		`✖ ${BREAK_LABEL} needs ${String(MIN_BREAK_CONDITIONS)} conditions or "${NO_BREAK_ESCAPE}"`,
	]
}

// Every violation the mechanical checks find, in a fixed order; an empty array is a clean summary.
function lint_report(summary: string): ReadonlyArray<string> {
	return [
		...fence_violation(summary),
		...label_violations(summary),
		...length_violations(summary),
		...intrusion_violations(summary),
		...case_line_violations(summary),
		...na_reason_violations(summary),
		...break_violations(summary),
	]
}

const report_lint = {
	lint_report,
	REQUIRED_LABELS,
	MAX_OVERVIEW_CHARS,
	CASE_LABEL,
	CASE_VOCABULARY,
	BREAK_LABEL,
	NA_LABEL,
	NO_BREAK_ESCAPE,
	MIN_BREAK_CONDITIONS,
}

export { report_lint }
