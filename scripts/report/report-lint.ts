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

// The overview region is the lines between `■ 概要` and `技術詳細`; the length and intrusion checks
// apply there alone, since `変更とテスト` legitimately carries file paths.
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

// Every violation the mechanical checks find, in a fixed order; an empty array is a clean summary.
function lint_report(summary: string): ReadonlyArray<string> {
	return [
		...fence_violation(summary),
		...label_violations(summary),
		...length_violations(summary),
		...intrusion_violations(summary),
	]
}

const report_lint = {
	lint_report,
	REQUIRED_LABELS,
	MAX_OVERVIEW_CHARS,
}

export { report_lint }
