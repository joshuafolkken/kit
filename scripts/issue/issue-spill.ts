import { epic_audit_logic } from '#scripts/epic/epic-audit'
import { issue_cite } from './issue-cite'
import { markdown_section } from './markdown-section'

// `josh issue:spill <N>` — the body work: which acceptance lines of #N are still unchecked, the
// follow-up body they move into, and #N's body with them replaced by one link line. Nothing here
// reads or writes GitHub; `issue-spill-cli.ts` does.
//
// **The estimate is the caller's, never apportioned**: the share of moved criteria says nothing about
// the files and lines they need, so the follow-up's size-estimate line is built from `--estimate`.

const BACKGROUND_HEADING = '## 背景'
const HEADING_PREFIX = '## '
const ESTIMATE_PREFIX = '- 規模見積もり:'
const UNCHECKED_PATTERN = /^\s*[-*+]\s+\[ \]\s+\S/u
const LIST_ITEM_PATTERN = /^\s*(?:[-*+]|\d+\.)\s/u
const CONTINUATION_PATTERN = /^\s+\S/u
const DECLARATION_PATTERN = /^-\s+[^:：\s][^:：]*[:：]/u
const ESTIMATE_PATTERN = /^(?:約\s*)?(?<files>\d+)\s*ファイル\s*\/\s*(?<lines>\d+)\s*行$/u

interface SpillSubject {
	issue_number: number
	title: string
	body: string
}

interface LineRange {
	start: number
	end: number
}

// The acceptance section's lines, its heading excluded, as indices into the body's lines.
function acceptance_range(visible: ReadonlyArray<string>): LineRange | undefined {
	const heading = visible.findIndex((line) => epic_audit_logic.is_acceptance_heading(line))

	if (heading === -1) return undefined
	const end = visible.findIndex(
		(line, index) => index > heading && line.trimStart().startsWith(HEADING_PREFIX),
	)

	return { start: heading + 1, end: end === -1 ? visible.length : end }
}

function is_continuation(line: string): boolean {
	return CONTINUATION_PATTERN.test(line) && !LIST_ITEM_PATTERN.test(line)
}

function is_moved(line: string, is_previous_moved: boolean): boolean {
	return UNCHECKED_PATTERN.test(line) || (is_previous_moved && is_continuation(line))
}

// The line indices of each unchecked criterion, its indented continuation lines included, in body
// order. A fenced line is never a criterion.
function unchecked_indices(body: string): ReadonlyArray<number> {
	const visible = markdown_section.unfenced_lines(body)
	const range = acceptance_range(visible)

	if (range === undefined) return []
	const indices: Array<number> = []
	let is_previous_moved = false

	for (let index = range.start; index < range.end; index += 1) {
		is_previous_moved = is_moved(visible[index] ?? '', is_previous_moved)
		if (is_previous_moved) indices.push(index)
	}

	return indices
}

function unchecked_lines(body: string): ReadonlyArray<string> {
	const lines = markdown_section.lines_of(body)

	return unchecked_indices(body).map((index) => lines[index] ?? '')
}

// `--estimate "<files> / <lines>"` as the declaration line `size-estimate.ts` reads, or `undefined`.
function estimate_line(estimate: string): string | undefined {
	const groups = ESTIMATE_PATTERN.exec(estimate.trim())?.groups

	if (groups === undefined) return undefined

	return `${ESTIMATE_PREFIX} 約 ${String(groups['files'])} ファイル / ${String(groups['lines'])} 行（テスト除く）`
}

// #N's background declarations (`- <key>: <value>`), its own size estimate left out for the caller's.
function declarations(body: string): ReadonlyArray<string> {
	return markdown_section
		.section_lines(body, BACKGROUND_HEADING)
		.filter((line) => DECLARATION_PATTERN.test(line) && !line.startsWith(ESTIMATE_PREFIX))
}

function follow_up_title(subject: SpillSubject): string {
	return `Follow up ${issue_cite.plain(subject.issue_number)}: ${subject.title}`
}

function follow_up_body(subject: SpillSubject, estimate: string): string {
	const origin = issue_cite.plain(subject.issue_number)

	return [
		BACKGROUND_HEADING,
		'',
		`${origin} から切り出し。`,
		'',
		...declarations(subject.body),
		estimate,
		'',
		'## 現象',
		'',
		`${origin} の受け入れ条件のうち、下の行が未完了のまま残った。`,
		'',
		'## 期待結果',
		'',
		`${origin} の \`## 期待結果\` のうち、下の受け入れ条件が求める部分を満たす。`,
		'',
		'## 受け入れ条件',
		'',
		...unchecked_lines(subject.body),
		'',
	].join('\n')
}

// #N's body with its unchecked criteria replaced, where the first stood, by one link line.
function kept_body(body: string, follow_up: number): string {
	const moved = unchecked_indices(body)
	const [first] = moved
	const link = `- → ${issue_cite.plain(follow_up)} に移した`

	return markdown_section
		.lines_of(body)
		.map((line, index) => (index === first ? link : line))
		.filter((_line, index) => index === first || !moved.includes(index))
		.join('\n')
}

const issue_spill = {
	estimate_line,
	follow_up_body,
	follow_up_title,
	kept_body,
	unchecked_lines,
}

export type { SpillSubject }
export { issue_spill }
