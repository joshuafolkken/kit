import { describe, expect, it } from 'vitest'
import { issue_bug_label } from './issue-bug-label'

const BUG_BODY = '## 背景\n\n- 種別: 不具合\n'
const OTHER_BODY = '## 背景\n\n- 種別: 振る舞い変更\n'
const EXISTING_LABELS = ['route:split', 'depth:1']

describe('issue_bug_label', () => {
	it('recognizes only the exact bug declaration line', () => {
		expect(issue_bug_label.is_bug_fix(BUG_BODY)).toBe(true)
		expect(issue_bug_label.is_bug_fix(OTHER_BODY)).toBe(false)
		expect(issue_bug_label.is_bug_fix('説明: - 種別: 不具合')).toBe(false)
	})

	it('adds bug while preserving existing labels', () => {
		expect(issue_bug_label.labels_for(BUG_BODY, EXISTING_LABELS)).toEqual([
			...EXISTING_LABELS,
			'bug',
		])
		expect(issue_bug_label.labels_for(OTHER_BODY, EXISTING_LABELS)).toEqual(EXISTING_LABELS)
	})

	it('does not duplicate an existing bug label', () => {
		expect(issue_bug_label.labels_for(BUG_BODY, [...EXISTING_LABELS, 'bug'])).toEqual([
			...EXISTING_LABELS,
			'bug',
		])
	})
})
