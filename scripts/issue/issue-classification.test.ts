import { BREAKING_CHANGE_LABEL, ENHANCEMENT_LABEL } from '#scripts/git/issue-labels'
import { describe, expect, it } from 'vitest'
import { issue_classification } from './issue-classification'

const BODY = '## 背景\n\n'
const EXISTING = ['route:split', 'depth:1']
const NON_BUG = '- 種別: 非不具合'
const BUG_ENHANCEMENT_CONFLICT = 'bug and enhancement declarations cannot be combined'
const BUG_CLASSIFICATION_CONFLICT = 'conflicting bug classifications'
const MISSING_BUG_CLASSIFICATION = 'missing bug classification'
const FEATURE_IMPROVEMENT = '- 目的: 機能改善'
const BREAKING_CHANGE = '- 互換性: 破壊的変更'

describe('issue classification', () => {
	it.each([
		{ declaration: '- 目的: 機能追加', labels: [ENHANCEMENT_LABEL] },
		{ declaration: FEATURE_IMPROVEMENT, labels: [ENHANCEMENT_LABEL] },
		{ declaration: BREAKING_CHANGE, labels: [BREAKING_CHANGE_LABEL] },
		{ declaration: '- 種別: 不具合', labels: ['bug'] },
		{
			declaration: '- 目的: 機能追加\n- 互換性: 破壊的変更',
			labels: [ENHANCEMENT_LABEL, BREAKING_CHANGE_LABEL],
		},
	])('classifies $declaration from the body', ({ declaration, labels }) => {
		expect(issue_classification.required_labels(`${BODY}${declaration}\n`)).toEqual(labels)
	})

	it.each([
		'修理: enhancement という単語がタイトルにある',
		'- 種別: 文書整備',
		'- 種別: 依存更新',
		'- 種別: 保守作業',
		'- 互換性: 維持',
		'説明: - 目的: 機能追加',
	])('does not infer labels from %s', (description) => {
		expect(issue_classification.required_labels(`${BODY}${description}\n`)).toEqual([])
	})

	it('ignores classification declarations in the reproduction section', () => {
		const body = `${BODY}## 再現\n\n- 目的: 機能追加\n- 互換性: 破壊的変更\n`

		expect(issue_classification.required_labels(body)).toEqual([])
	})

	it('rejects conflicting bug and enhancement declarations', () => {
		const body = `${BODY}- 種別: 不具合\n- 目的: 機能改善\n`

		expect(issue_classification.problems(body)).toEqual([BUG_ENHANCEMENT_CONFLICT])
	})
})

describe('explicit bug classification', () => {
	it.each([
		'配布済みフックが作業ディレクトリによって実行されない',
		'サブディレクトリから起動すると監査が走らない',
	])('requires a bug decision even when the body describes a failure: %s', (description) => {
		expect(issue_classification.problems(`${BODY}${description}\n`)).toContain(
			MISSING_BUG_CLASSIFICATION,
		)
	})

	it('accepts an explicit non-bug decision without adding a bug label', () => {
		const body = `${BODY}${NON_BUG}\n- 目的: 機能改善\n`

		expect(issue_classification.problems(body)).toEqual([])
		expect(issue_classification.labels_for(body, EXISTING)).toEqual([
			...EXISTING,
			ENHANCEMENT_LABEL,
		])
	})

	it('rejects contradictory bug decisions', () => {
		expect(issue_classification.problems(`${BODY}- 種別: 不具合\n${NON_BUG}\n`)).toContain(
			BUG_CLASSIFICATION_CONFLICT,
		)
	})

	it('reports both conflicts in one check', () => {
		const body = `${BODY}- 種別: 不具合\n${NON_BUG}\n- 目的: 機能改善\n`

		expect(issue_classification.problems(body)).toEqual([
			BUG_CLASSIFICATION_CONFLICT,
			BUG_ENHANCEMENT_CONFLICT,
		])
	})
})

describe('fenced classification examples', () => {
	it('ignores a background heading and bug declaration inside a fenced example', () => {
		const body = `\`\`\`md\n## 背景\n- 種別: 不具合\n\`\`\`\n## 背景\n${NON_BUG}\n`

		expect(issue_classification.required_labels(body)).toEqual([])
		expect(issue_classification.problems(body)).toEqual([])
	})

	it.each([FEATURE_IMPROVEMENT, BREAKING_CHANGE])(
		'ignores %s inside a fenced example',
		(declaration) => {
			const body = `${BODY}${NON_BUG}\n\`\`\`md\n${declaration}\n\`\`\`\n`

			expect(issue_classification.required_labels(body)).toEqual([])
		},
	)

	it('ignores non-bug declarations inside fenced examples', () => {
		const body = `${BODY}\`\`\`md\n${NON_BUG}\n\`\`\`\n`

		expect(issue_classification.problems(body)).toContain(MISSING_BUG_CLASSIFICATION)
	})

	it('uses real declarations when a fenced example disagrees', () => {
		const body = `${BODY}- 種別: 不具合\n~~~md\n${NON_BUG}\n~~~\n`

		expect(issue_classification.problems(body)).toEqual([])
		expect(issue_classification.required_labels(body)).toEqual(['bug'])
	})

	it('keeps a fence open when a closing marker has an info string', () => {
		const body = `${BODY}\`\`\`md\n\`\`\`md\n${NON_BUG}\n\`\`\`\n- 種別: 不具合\n`

		expect(issue_classification.problems(body)).toEqual([])
		expect(issue_classification.required_labels(body)).toEqual(['bug'])
	})
})

describe('indented classification examples', () => {
	it('ignores non-bug declarations inside indented code', () => {
		const body = `${BODY}    ${NON_BUG}\n`

		expect(issue_classification.problems(body)).toContain(MISSING_BUG_CLASSIFICATION)
	})

	it('treats a four-space indented marker as code rather than a fence', () => {
		expect(issue_classification.problems(`${BODY}    \`\`\`\n${NON_BUG}\n`)).toEqual([])
		expect(issue_classification.problems(`${BODY}   \`\`\`\n${NON_BUG}\n`)).toContain(
			MISSING_BUG_CLASSIFICATION,
		)
	})
})

describe('issue classification with existing labels', () => {
	it('preserves route and depth while adding each missing classification once', () => {
		const body = `${BODY}- 目的: 機能改善\n- 互換性: 破壊的変更\n`

		expect(issue_classification.labels_for(body, EXISTING)).toEqual([
			...EXISTING,
			ENHANCEMENT_LABEL,
			BREAKING_CHANGE_LABEL,
		])
		expect(issue_classification.labels_for(body, [...EXISTING, 'Enhancement'])).toEqual([
			...EXISTING,
			'Enhancement',
			BREAKING_CHANGE_LABEL,
		])
	})
})
