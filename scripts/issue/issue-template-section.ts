import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { package_path } from '#scripts/init/init-paths'
import { issue_body_keys, type Column } from './issue-body-keys'
import { markdown_section } from './markdown-section'

// One section of the Issue body template, cut from the fenced template in `issue-template.md` — its
// single source — so a refusal for a missing heading can print the section to paste back in rather than
// sending the filer to reopen the document (joshuafolkken/kit#5206). The body's column picks the
// template: its headings are the ones the refusal names (joshuafolkken/kit#7211).
const TEMPLATE_PATHS: Readonly<Record<Column, string>> = {
	ja: 'prompts/collaboration-workflow/issue-template.md',
	en: 'prompts/collaboration-workflow/issue-template.en.md',
}
const TEMPLATE_FENCE = '````'
// The sections of `issue-template.md` a refusal sends the filer to, so the filer reads that one section
// (`josh doc:section`) rather than the whole document (joshuafolkken/kit#8763). They live in the
// Japanese document alone: the English one carries the template and its correspondence table only.
const POINTED_SECTIONS = {
	declarations: `\`## ${issue_body_keys.TABLES.headings.background.ja}\` 直下の宣言と分類ラベル`,
	judgement: '人の判断の選び方',
	priority: '優先度の基準',
	kind: '種別の分け方',
} as const

type PointedSection = keyof typeof POINTED_SECTIONS

// The lines inside the document's four-backtick template fence; an empty array when it has none.
function template_lines(document: string): ReadonlyArray<string> {
	const lines = markdown_section.lines_of(document)
	const start = lines.findIndex((line) => line.startsWith(TEMPLATE_FENCE))
	const end = lines.findIndex((line, index) => index > start && line.trim() === TEMPLATE_FENCE)

	if (start === -1 || end === -1) return []

	return lines.slice(start + 1, end)
}

// The heading and its template lines, trailing blank lines dropped; `undefined` when the template has no
// such section.
function section_of(document: string, heading: string): string | undefined {
	const template = template_lines(document).join('\n')

	if (!markdown_section.has_line(template, heading)) return undefined

	return [heading, ...markdown_section.section_lines(template, heading)].join('\n').trimEnd()
}

// The template document's file name in the body's column, for a refusal that sends the filer to it.
function document_name(): string {
	return path.basename(TEMPLATE_PATHS[issue_body_keys.column()])
}

// A package without the template prints the bare problem rather than failing the lint.
function section(heading: string): string | undefined {
	const template_path = package_path(TEMPLATE_PATHS[issue_body_keys.column()])

	if (!existsSync(template_path)) return undefined

	return section_of(readFileSync(template_path, 'utf8'), heading)
}

// `` `issue-template.md` → "<heading>" `` — the section reference a refusal cites.
function pointer(section_key: PointedSection): string {
	return `\`${path.basename(TEMPLATE_PATHS.ja)}\` → "${POINTED_SECTIONS[section_key]}"`
}

const issue_template_section = { POINTED_SECTIONS, document_name, pointer, section, section_of }

export { issue_template_section }
export type { PointedSection }
