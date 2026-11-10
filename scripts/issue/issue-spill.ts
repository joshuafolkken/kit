import { epic_audit_logic } from '#scripts/epic/epic-audit'
import { split_assess } from '#scripts/split/split-assess'
import { expected_effect_lint } from './expected-effect-lint'
import { issue_cite } from './issue-cite'
import { markdown_section } from './markdown-section'

// `josh issue:spill <N>` — the body work: which acceptance lines of #N are still unchecked, the
// follow-up body they move into, and #N's body with them replaced by one link line. Nothing here
// reads or writes GitHub; `issue-spill-cli.ts` does.
//
// **The sizing is the caller's, never apportioned**: the share of moved criteria says nothing about
// the files and lines they need, so the follow-up's size-estimate line is built from `--estimate`,
// and its reason for staying one Issue only from `--reason` — #N's own reason was about #N.

const BACKGROUND_HEADING = '## 背景'
const HEADING_PREFIX = '## '
const ESTIMATE_PREFIX = '- 規模見積もり:'
const SIZING_PREFIXES: ReadonlyArray<string> = [ESTIMATE_PREFIX, split_assess.REASON_PREFIX]
const UNCHECKED_PATTERN = /^\s*[-*+]\s+\[ \]\s+\S/u
const CHECKED_PATTERN = /^\s*[-*+]\s+\[[xX]\]\s+\S/u
// No line's indent is negative, so this owner stands for "not inside an unchecked criterion".
const OUTSIDE = -1
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

function indent_of(line: string): number {
	return line.length - line.trimStart().length
}

// The marker indent of the unchecked criterion `line` belongs to, or `OUTSIDE`. Every non-blank line
// indented past the marker — a wrapped tail, a sub-item (unchecked ones too), a deep continuation —
// is part of it; only a line outside it can start the next one.
function owner_of(line: string, owner: number): number {
	const is_inside = owner !== OUTSIDE && line.trim() !== '' && indent_of(line) > owner

	if (is_inside) return owner

	return UNCHECKED_PATTERN.test(line) ? indent_of(line) : OUTSIDE
}

// The line indices of each unchecked criterion, its indented lines included, in body order. A fenced
// line is never a criterion.
function unchecked_indices(body: string): ReadonlyArray<number> {
	const visible = markdown_section.fence_free_lines(body)
	const range = acceptance_range(visible)

	if (range === undefined) return []
	const indices: Array<number> = []
	let owner = OUTSIDE

	for (let index = range.start; index < range.end; index += 1) {
		owner = owner_of(visible[index] ?? '', owner)
		if (owner !== OUTSIDE) indices.push(index)
	}

	return indices
}

// How many acceptance criteria are checked — the green part a spill leaves behind. A fenced line is
// never a criterion.
function checked_count(body: string): number {
	const visible = markdown_section.fence_free_lines(body)
	const range = acceptance_range(visible)

	if (range === undefined) return 0

	return visible.slice(range.start, range.end).filter((line) => CHECKED_PATTERN.test(line)).length
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

// `--reason "<reason>"` as the reason line `size_estimate` excuses the size bar with, or
// `undefined` for a blank one.
function reason_line(reason: string): string | undefined {
	const trimmed = reason.trim()

	return trimmed === '' ? undefined : `${split_assess.REASON_PREFIX} ${trimmed}`
}

function is_sizing(line: string): boolean {
	return SIZING_PREFIXES.some((prefix) => line.startsWith(prefix))
}

// #N's background declarations (`- <key>: <value>`), its own sizing left out for the caller's.
function declarations(body: string): ReadonlyArray<string> {
	return markdown_section
		.section_lines(body, BACKGROUND_HEADING)
		.filter((line) => DECLARATION_PATTERN.test(line) && !is_sizing(line))
}

// #N's expected-effect section, heading included, or nothing when #N has none: a run-time-shortening
// aim carried over in the declarations makes `issue:file` require it (`expected-effect-lint.ts`).
function effect_section(body: string): ReadonlyArray<string> {
	const lines = markdown_section.section_lines(body, expected_effect_lint.HEADING)

	return lines.length === 0 ? [] : [expected_effect_lint.HEADING, ...lines]
}

function follow_up_title(subject: SpillSubject): string {
	return `Follow up ${issue_cite.plain_for('github', subject.issue_number)}: ${subject.title}`
}

// `sizing` is the caller's size lines: the estimate, then a reason line when one was given.
function follow_up_body(subject: SpillSubject, sizing: ReadonlyArray<string>): string {
	const origin = issue_cite.plain_for('github', subject.issue_number)

	return [
		BACKGROUND_HEADING,
		'',
		`${origin} から切り出し。`,
		'',
		...declarations(subject.body),
		...sizing,
		'',
		'## 現象',
		'',
		`${origin} の受け入れ条件のうち、下の行が未完了のまま残った。`,
		'',
		'## 期待結果',
		'',
		`${origin} の \`## 期待結果\` のうち、下の受け入れ条件が求める部分を満たす。`,
		'',
		...effect_section(subject.body),
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
	const link = `- → ${issue_cite.plain_for('github', follow_up)} に移した`

	return markdown_section
		.lines_of(body)
		.map((line, index) => (index === first ? link : line))
		.filter((_line, index) => index === first || !moved.includes(index))
		.join('\n')
}

const issue_spill = {
	checked_count,
	estimate_line,
	follow_up_body,
	follow_up_title,
	kept_body,
	reason_line,
	unchecked_lines,
}

export type { SpillSubject }
export { issue_spill }
