import {
	BREAKING_CHANGE_LABEL,
	BUG_LABEL,
	ENHANCEMENT_LABEL,
	has_label_name,
} from '#scripts/git/issue-labels'
import { issue_bug_label } from './issue-bug-label'
import { markdown_section } from './markdown-section'

const FEATURE_DECLARATIONS = ['- 目的: 機能追加', '- 目的: 機能改善']
const BREAKING_DECLARATION = '- 互換性: 破壊的変更'
const CLASSIFICATION_LABELS = [BUG_LABEL, ENHANCEMENT_LABEL, BREAKING_CHANGE_LABEL]
const CONFLICT = 'bug and enhancement declarations cannot be combined'

function required_labels(body: string): ReadonlyArray<string> {
	const labels: Array<string> = []
	const background = markdown_section.section_lines(body, '## 背景').join('\n')

	if (issue_bug_label.is_bug_fix(body)) labels.push(BUG_LABEL)

	if (FEATURE_DECLARATIONS.some((line) => markdown_section.has_line(background, line))) {
		labels.push(ENHANCEMENT_LABEL)
	}

	if (markdown_section.has_line(background, BREAKING_DECLARATION)) {
		labels.push(BREAKING_CHANGE_LABEL)
	}

	return labels
}

function labels_for(body: string, existing: ReadonlyArray<string>): ReadonlyArray<string> {
	const missing = required_labels(body).filter((label) => !has_label_name(existing, label))

	return [...existing, ...missing]
}

function problems(body: string): ReadonlyArray<string> {
	const labels = required_labels(body)

	return labels.includes(BUG_LABEL) && labels.includes(ENHANCEMENT_LABEL) ? [CONFLICT] : []
}

const issue_classification = {
	BREAKING_DECLARATION,
	CLASSIFICATION_LABELS,
	FEATURE_DECLARATIONS,
	labels_for,
	problems,
	required_labels,
}

export { issue_classification }
