import { issue_bug_label } from './issue-bug-label'
import { BREAKING_CHANGE_LABEL, BUG_LABEL, ENHANCEMENT_LABEL, has_label_name } from './issue-labels'
import { markdown_section } from './markdown-section'

const FEATURE_DECLARATIONS = ['- 目的: 機能追加', '- 目的: 機能改善']
const BREAKING_DECLARATION = '- 互換性: 破壊的変更'
const NON_BUG_DECLARATION = '- 種別: 非不具合'
const CLASSIFICATION_LABELS = [BUG_LABEL, ENHANCEMENT_LABEL, BREAKING_CHANGE_LABEL]
const CONFLICT = 'bug and enhancement declarations cannot be combined'
const MISSING_BUG_CLASSIFICATION = 'missing bug classification'
const CONFLICTING_BUG_CLASSIFICATIONS = 'conflicting bug classifications'

function required_labels(body: string): ReadonlyArray<string> {
	const labels: Array<string> = []
	const background = markdown_section.section_lines(body, '## 背景').join('\n')

	if (issue_bug_label.is_bug_fix(body)) labels.push(BUG_LABEL)

	if (FEATURE_DECLARATIONS.some((line) => markdown_section.has_unfenced_line(background, line))) {
		labels.push(ENHANCEMENT_LABEL)
	}

	if (markdown_section.has_unfenced_line(background, BREAKING_DECLARATION)) {
		labels.push(BREAKING_CHANGE_LABEL)
	}

	return labels
}

function labels_for(body: string, existing: ReadonlyArray<string>): ReadonlyArray<string> {
	const missing = required_labels(body).filter((label) => !has_label_name(existing, label))

	return [...existing, ...missing]
}

function bug_classification_problem(body: string): string | undefined {
	const background = markdown_section.section_lines(body, '## 背景').join('\n')
	const has_bug = issue_bug_label.is_bug_fix(body)
	const has_non_bug = markdown_section.has_unfenced_line(background, NON_BUG_DECLARATION)

	if (!has_bug && !has_non_bug) return MISSING_BUG_CLASSIFICATION
	if (has_bug && has_non_bug) return CONFLICTING_BUG_CLASSIFICATIONS

	return undefined
}

function problems(body: string): ReadonlyArray<string> {
	const classification_problem = bug_classification_problem(body)
	const found: Array<string> = []

	if (classification_problem !== undefined) found.push(classification_problem)
	const labels = required_labels(body)

	if (labels.includes(BUG_LABEL) && labels.includes(ENHANCEMENT_LABEL)) found.push(CONFLICT)

	return found
}

const issue_classification = {
	CLASSIFICATION_LABELS,
	labels_for,
	problems,
	required_labels,
}

export { issue_classification }
