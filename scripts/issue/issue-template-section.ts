import { existsSync, readFileSync } from 'node:fs'
import { package_path } from '#scripts/init/init-paths'
import { markdown_section } from './markdown-section'

// One section of the Issue body template, cut from the fenced template in `issue-template.md` — its
// single source — so a refusal for a missing heading can print the section to paste back in rather than
// sending the filer to reopen the document (joshuafolkken/kit#5206).
const TEMPLATE_PATH = 'prompts/collaboration-workflow/issue-template.md'
const TEMPLATE_FENCE = '````'

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

// A package without the template prints the bare problem rather than failing the lint.
function section(heading: string): string | undefined {
	const template_path = package_path(TEMPLATE_PATH)

	if (!existsSync(template_path)) return undefined

	return section_of(readFileSync(template_path, 'utf8'), heading)
}

const issue_template_section = { section, section_of }

export { issue_template_section }
