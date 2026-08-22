import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('../scripts/git/git-next-issues', () => ({
	git_next_issues: {
		fetch_next_issue_lines: vi.fn<() => Promise<Array<string>>>().mockResolvedValue([]),
	},
}))

vi.mock('../scripts/git/git-error', () => ({
	git_error: { handle: vi.fn() },
}))

const { git_followup_workflow } = await import('./git-followup-workflow')

describe('parse_issue_number_from_text', () => {
	it('returns undefined for undefined input', () => {
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

describe('is_merge_resolved', () => {
	it('returns true when no flags are set', () => {
		expect(git_followup_workflow.is_merge_resolved({})).toBe(true)
	})

	it('returns false when --no-merge is set', () => {
		expect(git_followup_workflow.is_merge_resolved({ 'no-merge': true })).toBe(false)
	})

	it('returns true when --merge is set without --no-merge (backward compat)', () => {
		expect(git_followup_workflow.is_merge_resolved({ merge: true })).toBe(true)
	})

	it('returns false when both --merge and --no-merge are set (--no-merge wins)', () => {
		expect(git_followup_workflow.is_merge_resolved({ merge: true, 'no-merge': true })).toBe(false)
	})
})

describe('print_project_version', () => {
	it('logs the formatted project version line for the current project', () => {
		const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		try {
			git_followup_workflow.print_project_version()
			expect(spy).toHaveBeenCalledWith(
				expect.stringMatching(/^📦 project version: \d+\.\d+\.\d+$/u),
			)
		} finally {
			spy.mockRestore()
		}
	})
})

const { git_next_issues } = await import('../scripts/git/git-next-issues')
const fetch_next_issue_lines_mock = vi.mocked(git_next_issues.fetch_next_issue_lines)

const NEXT_ISSUES_HEADER = '🗒 Next issues (newest first):'

// Importing the module runs `main()` (parseArgs is mocked to an empty parse), which already calls
// the mock once. Without this every `toHaveBeenCalledWith` would match that call instead of the
// one the test made, and an inverted gate or a broken parser would still pass.
beforeEach(() => {
	fetch_next_issue_lines_mock.mockClear()
})

describe('print_next_issues - output', () => {
	it('prints each returned line', async () => {
		const lines = [NEXT_ISSUES_HEADER, '  1. #9 Issue 9']

		fetch_next_issue_lines_mock.mockResolvedValueOnce(lines)
		const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		try {
			await git_followup_workflow.print_next_issues('42')
			expect(spy).toHaveBeenCalledTimes(lines.length)
			expect(spy).toHaveBeenNthCalledWith(1, lines[0])
			expect(spy).toHaveBeenNthCalledWith(2, lines[1])
		} finally {
			spy.mockRestore()
		}
	})

	it('prints nothing when there are no lines', async () => {
		fetch_next_issue_lines_mock.mockResolvedValueOnce([])
		const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		try {
			await git_followup_workflow.print_next_issues(undefined)
			expect(spy).not.toHaveBeenCalled()
		} finally {
			spy.mockRestore()
		}
	})
})

describe('print_next_issues - completed issue number', () => {
	it('passes the completed issue number as a number', async () => {
		fetch_next_issue_lines_mock.mockResolvedValueOnce([])
		await git_followup_workflow.print_next_issues('42')

		expect(fetch_next_issue_lines_mock).toHaveBeenLastCalledWith(42)
	})

	// `--issue-number "#42"` is the shape the positional parser accepts, so the exclusion must
	// read it the same way rather than silently skipping it.
	it('accepts the #N shape', async () => {
		fetch_next_issue_lines_mock.mockResolvedValueOnce([])
		await git_followup_workflow.print_next_issues('#42')

		expect(fetch_next_issue_lines_mock).toHaveBeenLastCalledWith(42)
	})

	it('passes undefined when no issue number is known', async () => {
		fetch_next_issue_lines_mock.mockResolvedValueOnce([])
		await git_followup_workflow.print_next_issues(undefined)

		expect(fetch_next_issue_lines_mock).toHaveBeenLastCalledWith(undefined)
	})

	// Number('42a') is NaN, which compares unequal to every issue number and would silently
	// disable the just-completed-issue exclusion.
	it('passes undefined for a non-numeric issue number instead of NaN', async () => {
		fetch_next_issue_lines_mock.mockResolvedValueOnce([])
		await git_followup_workflow.print_next_issues('42a')

		expect(fetch_next_issue_lines_mock).toHaveBeenLastCalledWith(undefined)
	})
})

// The epic auto-close is gated on the merge for the same reason: on `--no-merge` the linked issue
// is still open and still the current task, so a "next" list would hide the one issue that matters.
describe('print_completion - merge gating', () => {
	it('lists next issues on a merged run', async () => {
		fetch_next_issue_lines_mock.mockResolvedValueOnce([])
		const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		try {
			await git_followup_workflow.print_completion('42', true)
			expect(fetch_next_issue_lines_mock).toHaveBeenLastCalledWith(42)
		} finally {
			spy.mockRestore()
		}
	})

	it('skips the next-issues list on a --no-merge run', async () => {
		const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		try {
			await git_followup_workflow.print_completion('42', false)
			expect(fetch_next_issue_lines_mock).not.toHaveBeenCalled()
		} finally {
			spy.mockRestore()
		}
	})

	// The version line is the documented final line of the console output.
	it('prints the project version last', async () => {
		fetch_next_issue_lines_mock.mockResolvedValueOnce([NEXT_ISSUES_HEADER])
		const spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		try {
			await git_followup_workflow.print_completion('42', true)
			const last_call = spy.mock.calls.at(-1)

			expect(last_call?.[0]).toMatch(/^📦 project version: \d+\.\d+\.\d+$/u)
		} finally {
			spy.mockRestore()
		}
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
