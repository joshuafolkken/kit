import { describe, expect, it } from 'vitest'
import { issue_bug_label } from './issue-bug-label'

const BUG_BODY = '## 背景\n\n- 種別: 不具合\n'
const OTHER_BODY = '## 背景\n\n- 種別: 振る舞い変更\n'

describe('issue_bug_label', () => {
	it('recognizes only the exact bug declaration line', () => {
		expect(issue_bug_label.is_bug_fix(BUG_BODY)).toBe(true)
		expect(issue_bug_label.is_bug_fix(OTHER_BODY)).toBe(false)
		expect(issue_bug_label.is_bug_fix('説明: - 種別: 不具合')).toBe(false)
	})

	it('ignores bug declarations outside the background section', () => {
		const body = '## 背景\n\n- 目的: 機能改善\n\n## 再現\n\n- 種別: 不具合\n'

		expect(issue_bug_label.is_bug_fix(body)).toBe(false)
	})

	it('ignores bug declarations inside fenced examples', () => {
		const body = '## 背景\n\n```md\n- 種別: 不具合\n```\n'

		expect(issue_bug_label.is_bug_fix(body)).toBe(false)
	})
})
