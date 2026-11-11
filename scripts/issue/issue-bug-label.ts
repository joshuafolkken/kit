import { issue_body_keys } from './issue-body-keys'
import { markdown_section } from './markdown-section'

const BUG_DECLARATION_LINE = issue_body_keys.line('kind', 'bug')

function is_bug_fix(body: string): boolean {
	const background = markdown_section
		.section_lines(body, issue_body_keys.heading('background'))
		.join('\n')

	return markdown_section.has_unfenced_line(background, BUG_DECLARATION_LINE)
}

const issue_bug_label = { BUG_DECLARATION_LINE, is_bug_fix }

export { issue_bug_label }
