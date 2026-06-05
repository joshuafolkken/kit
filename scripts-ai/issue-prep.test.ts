import { describe, expect, it, vi } from 'vitest'

const MOCK_ISSUE_TITLE = vi.hoisted(() => 'Fix login bug')
const IN_PROGRESS_LABEL = 'in-progress'
const execa_sync_spy = vi.hoisted(() =>
	vi.fn().mockReturnValue({ stdout: `${MOCK_ISSUE_TITLE}\n` }),
)

vi.mock('execa', () => ({
	execaSync: execa_sync_spy,
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

describe('fetch_issue_title — safe execaSync usage', () => {
	it('calls execaSync with gh and issue view arguments', () => {
		issue_prep.fetch_issue_title('42')

		expect(execa_sync_spy).toHaveBeenCalledWith('gh', [
			'issue',
			'view',
			'42',
			'--json',
			'title',
			'--jq',
			'.title',
		])
	})

	it('returns trimmed title from execaSync output', () => {
		expect(issue_prep.fetch_issue_title('42')).toBe(MOCK_ISSUE_TITLE)
	})
})

describe('ensure_in_progress_label', () => {
	it('calls execaSync with gh label create arguments', () => {
		execa_sync_spy.mockClear()
		issue_prep.ensure_in_progress_label()

		expect(execa_sync_spy).toHaveBeenCalledWith('gh', [
			'label',
			'create',
			IN_PROGRESS_LABEL,
			'--color',
			'#0075ca',
			'--description',
			'Work is actively in progress',
		])
	})

	it('does not throw when execaSync throws', () => {
		execa_sync_spy.mockImplementationOnce(() => {
			throw new Error('already exists')
		})

		expect(() => {
			issue_prep.ensure_in_progress_label()
		}).not.toThrow()
	})
})

describe('assign_in_progress_label', () => {
	it('calls execaSync with gh issue edit and add-label in-progress', () => {
		execa_sync_spy.mockClear()
		issue_prep.assign_in_progress_label('42')

		expect(execa_sync_spy).toHaveBeenCalledWith('gh', [
			'issue',
			'edit',
			'42',
			'--add-label',
			IN_PROGRESS_LABEL,
		])
	})
})
