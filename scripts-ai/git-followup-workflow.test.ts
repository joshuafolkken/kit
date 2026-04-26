import { describe, expect, it, vi } from 'vitest'

const RESOLVED_BRANCH = vi.hoisted(() => 'resolved-branch')

vi.mock('node:util', () => ({
	parseArgs: vi.fn().mockReturnValue({ values: {}, positionals: [] }),
}))

vi.mock('../scripts/git/git-pr-followup', () => ({
	git_pr_followup: { run: vi.fn<() => Promise<void>>().mockResolvedValue() },
}))

vi.mock('../scripts/git/git-branch', () => ({
	git_branch: { current: vi.fn().mockResolvedValue('main') },
}))

vi.mock('../scripts/git/git-notify', () => ({
	git_notify: { build_notify_config: vi.fn<() => void>().mockReturnValue() },
}))

vi.mock('../scripts/git/git-error', () => ({
	git_error: { handle: vi.fn() },
}))

const { git_followup_workflow } = await import('./git-followup-workflow')

describe('parse_issue_number_from_text', () => {
	it('returns undefined for undefined input', () => {
		// eslint-disable-next-line unicorn/no-useless-undefined -- explicitly testing undefined input
		expect(git_followup_workflow.parse_issue_number_from_text(undefined)).toBeUndefined()
	})

	it('returns undefined for empty string', () => {
		expect(git_followup_workflow.parse_issue_number_from_text('')).toBeUndefined()
	})

	it('extracts number from "#42" format', () => {
		expect(git_followup_workflow.parse_issue_number_from_text('#42')).toBe('42')
	})

	it('extracts number from bare digit string', () => {
		expect(git_followup_workflow.parse_issue_number_from_text('42')).toBe('42')
	})

	it('extracts trailing issue number from title string', () => {
		expect(git_followup_workflow.parse_issue_number_from_text('feat: fix bug #42')).toBe('42')
	})

	it('returns undefined when input has no issue number', () => {
		expect(git_followup_workflow.parse_issue_number_from_text('no number here')).toBeUndefined()
	})

	it('trims whitespace before extracting', () => {
		expect(git_followup_workflow.parse_issue_number_from_text('  #42  ')).toBe('42')
	})
})

describe('resolve_should_merge', () => {
	it('returns true when no flags are set', () => {
		expect(git_followup_workflow.resolve_should_merge({})).toBe(true)
	})

	it('returns false when --no-merge is set', () => {
		expect(git_followup_workflow.resolve_should_merge({ 'no-merge': true })).toBe(false)
	})

	it('returns true when --merge is set without --no-merge (backward compat)', () => {
		expect(git_followup_workflow.resolve_should_merge({ merge: true })).toBe(true)
	})

	it('returns false when both --merge and --no-merge are set (--no-merge wins)', () => {
		expect(git_followup_workflow.resolve_should_merge({ merge: true, 'no-merge': true })).toBe(
			false,
		)
	})
})

describe('resolve_branch_name', () => {
	it('returns the provided branch name trimmed', async () => {
		const result = await git_followup_workflow.resolve_branch_name('my-branch')

		expect(result).toBe('my-branch')
	})

	it('trims whitespace from provided branch name', async () => {
		const result = await git_followup_workflow.resolve_branch_name('  my-branch  ')

		expect(result).toBe('my-branch')
	})

	it('falls back to git_branch.current() when branch is undefined', async () => {
		const { git_branch } = await import('../scripts/git/git-branch')

		vi.mocked(git_branch.current).mockResolvedValue(RESOLVED_BRANCH)

		// eslint-disable-next-line unicorn/no-useless-undefined -- explicitly testing undefined input
		const result = await git_followup_workflow.resolve_branch_name(undefined)

		expect(result).toBe(RESOLVED_BRANCH)
	})

	it('falls back to git_branch.current() when branch is empty string', async () => {
		const { git_branch } = await import('../scripts/git/git-branch')

		vi.mocked(git_branch.current).mockResolvedValue(RESOLVED_BRANCH)

		const result = await git_followup_workflow.resolve_branch_name('')

		expect(result).toBe(RESOLVED_BRANCH)
	})
})
