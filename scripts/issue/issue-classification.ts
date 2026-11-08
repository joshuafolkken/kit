import { pr_classification } from '#scripts/ci/pr-classification'
import { error_text } from '#scripts/lib/error-message'
import { defect_origin_line } from './defect-origin-line'
import { issue_bug_label } from './issue-bug-label'
import {
	BREAKING_CHANGE_LABEL,
	BUG_LABEL,
	ENHANCEMENT_LABEL,
	has_label_name,
	OTHER_CHANGE_LABEL,
} from './issue-labels'
import { markdown_section } from './markdown-section'

const FEATURE_DECLARATIONS = ['- 目的: 機能追加', '- 目的: 機能改善', '- 目的: 時間短縮']
const BREAKING_DECLARATION = '- 互換性: 破壊的変更'
const NON_BUG_DECLARATION = '- 種別: 非不具合'
const NON_BUG_LINE = new RegExp(`^${NON_BUG_DECLARATION}$`, 'mu')
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

function label_conflict(body: string): string | undefined {
	const labels = required_labels(body)

	return labels.includes(BUG_LABEL) && labels.includes(ENHANCEMENT_LABEL) ? CONFLICT : undefined
}

// The refusal `josh pr` would give this body once filed, so a body that cannot ship is refused here.
function selection_problem(body: string): string | undefined {
	try {
		pr_classification.select_classification(required_labels(body), body)

		return undefined
	} catch (error) {
		return error_text.message_of(error)
	}
}

// A non-bug body declaring neither an aim nor a breaking change resolves to no release
// classification; `other-change` is the only one it can mean, so it is written in under the
// non-bug line. Any other body is returned unchanged.
function with_release_classification(body: string): string {
	const line = pr_classification.declaration(OTHER_CHANGE_LABEL)
	const amended = body.replace(NON_BUG_LINE, (non_bug) => `${non_bug}\n${line}`)

	if (selection_problem(body) === undefined || selection_problem(amended) !== undefined) return body

	return amended
}

function release_problem(body: string): string | undefined {
	if (bug_classification_problem(body) !== undefined || label_conflict(body) !== undefined) {
		return undefined
	}

	return selection_problem(with_release_classification(body))
}

function problems(body: string): ReadonlyArray<string> {
	const found = [
		bug_classification_problem(body),
		label_conflict(body),
		release_problem(body),
		defect_origin_line.problem(body),
		defect_origin_line.reproduction_problem(body),
	]

	return found.filter((problem) => problem !== undefined)
}

const issue_classification = {
	CLASSIFICATION_LABELS,
	labels_for,
	problems,
	required_labels,
	with_release_classification,
}

export { issue_classification }
