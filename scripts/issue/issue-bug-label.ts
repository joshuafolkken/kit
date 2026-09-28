import { BUG_LABEL, has_label_name } from '#scripts/git/issue-labels'
import { markdown_section } from './markdown-section'

const BUG_DECLARATION_LINE = '- 種別: 不具合'

function is_bug_fix(body: string): boolean {
	return markdown_section.has_line(body, BUG_DECLARATION_LINE)
}

function labels_for(body: string, labels: ReadonlyArray<string>): ReadonlyArray<string> {
	if (!is_bug_fix(body) || has_label_name(labels, BUG_LABEL)) return labels

	return [...labels, BUG_LABEL]
}

const issue_bug_label = { BUG_DECLARATION_LINE, is_bug_fix, labels_for }

export { issue_bug_label }
