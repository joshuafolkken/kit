import { describe, expect, it, vi } from 'vitest'

const MOCK_ISSUE_TITLE = vi.hoisted(() => 'Fix login bug')
const exec_file_spy = vi.hoisted(() => vi.fn().mockReturnValue(`${MOCK_ISSUE_TITLE}\n`))

vi.mock('node:child_process', () => ({
	execFileSync: exec_file_spy,
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

describe('fetch_issue_title — safe execFileSync usage', () => {
	it('calls execFileSync with gh and issue view arguments', () => {
		issue_prep.fetch_issue_title('42')

		expect(exec_file_spy).toHaveBeenCalledWith(
			'gh',
			['issue', 'view', '42', '--json', 'title', '--jq', '.title'],
			{ encoding: 'utf8' },
		)
	})

	it('returns trimmed title from execFileSync output', () => {
		expect(issue_prep.fetch_issue_title('42')).toBe(MOCK_ISSUE_TITLE)
	})
})
