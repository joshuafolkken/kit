import { markdown_section } from './markdown-section'

const BUG_DECLARATION_LINE = '- 種別: 不具合'

function is_bug_fix(body: string): boolean {
	const background = markdown_section.section_lines(body, '## 背景').join('\n')

	return markdown_section.has_unfenced_line(background, BUG_DECLARATION_LINE)
}

const issue_bug_label = { BUG_DECLARATION_LINE, is_bug_fix }

export { issue_bug_label }
