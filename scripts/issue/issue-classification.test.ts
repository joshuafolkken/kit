import { BREAKING_CHANGE_LABEL, ENHANCEMENT_LABEL } from '#scripts/git/issue-labels'
import { describe, expect, it } from 'vitest'
import { issue_classification } from './issue-classification'

const BODY = '## 背景\n\n'
const EXISTING = ['route:split', 'depth:1']

describe('issue classification', () => {
	it.each([
		{ declaration: '- 目的: 機能追加', labels: [ENHANCEMENT_LABEL] },
		{ declaration: '- 目的: 機能改善', labels: [ENHANCEMENT_LABEL] },
		{ declaration: '- 互換性: 破壊的変更', labels: [BREAKING_CHANGE_LABEL] },
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

		expect(issue_classification.problems(body)).toEqual([
			'bug and enhancement declarations cannot be combined',
		])
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
