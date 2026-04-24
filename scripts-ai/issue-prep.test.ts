import { describe, expect, it, vi } from 'vitest'

const MOCK_ISSUE_TITLE = vi.hoisted(() => 'Fix login bug')

vi.mock('node:child_process', () => ({
	execSync: vi.fn().mockReturnValue(MOCK_ISSUE_TITLE),
}))

vi.mock('../scripts/issue/issue-logic', () => ({
	issue_logic: {
		prepare: vi.fn().mockReturnValue({
			title: MOCK_ISSUE_TITLE,
			is_cjk: false,
			suggested_branch: '42-fix-login-bug',
		}),
	},
}))

process.argv = ['node', 'issue-prep.ts', '42']

const { issue_prep } = await import('./issue-prep')

describe('display_language_status', () => {
	it('returns CJK warning for true', () => {
		expect(issue_prep.display_language_status(true)).toBe(
			'⚠ Contains CJK — needs English translation',
		)
	})

	it('returns English confirmation for false', () => {
		expect(issue_prep.display_language_status(false)).toBe('✔ English')
	})
})
