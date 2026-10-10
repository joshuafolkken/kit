import { git_gh_command } from '#scripts/gh/git-gh-command'
import { session_cite } from '#scripts/issue/session-cite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_followup_issue_close } from './git-followup-issue-close'

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		issue_get_state_and_relations: vi.fn(),
		issue_close: vi.fn(),
	},
}))

const ISSUE_NUMBER = '2779'
const PR_URL = 'https://github.com/joshuafolkken/kit/pull/2782'
const WAIT = { attempts: 3, interval_ms: 0, sleeper: vi.fn<() => Promise<void>>() }
const NO_ISSUE: string | undefined = undefined
const CLOSED = JSON.stringify({ number: 2779, state: 'CLOSED' })
const OPEN = JSON.stringify({ number: 2779, state: 'OPEN' })

const mocked_read = vi.mocked(git_gh_command.issue_get_state_and_relations)
const mocked_close = vi.mocked(git_gh_command.issue_close)

async function ensure(issue_number: string | undefined): Promise<void> {
	await git_followup_issue_close.ensure_issue_closed({ issue_number, pr_url: PR_URL }, WAIT)
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
	mocked_read.mockResolvedValue(CLOSED)
	mocked_close.mockResolvedValue(true)
})

describe('ensure_issue_closed — GitHub applied the closes keyword', () => {
	it('writes nothing when the issue is already closed', async () => {
		await ensure(ISSUE_NUMBER)

		expect(mocked_read).toHaveBeenCalledOnce()
		expect(mocked_close).not.toHaveBeenCalled()
	})

	it('waits for a close that lands on a later read instead of closing it itself', async () => {
		mocked_read.mockResolvedValueOnce(OPEN).mockResolvedValueOnce(CLOSED)

		await ensure(ISSUE_NUMBER)

		expect(mocked_read).toHaveBeenCalledTimes(2)
		expect(mocked_close).not.toHaveBeenCalled()
	})

	it('does nothing when the run has no issue number', async () => {
		await ensure(NO_ISSUE)

		expect(mocked_read).not.toHaveBeenCalled()
	})
})

describe('ensure_issue_closed — the merge left the issue open (joshuafolkken/kit#2770)', () => {
	it('closes the issue with a comment naming the merged pull request', async () => {
		mocked_read.mockResolvedValue(OPEN)

		await ensure(ISSUE_NUMBER)

		expect(mocked_read).toHaveBeenCalledTimes(WAIT.attempts)
		expect(mocked_close).toHaveBeenCalledWith(
			ISSUE_NUMBER,
			git_followup_issue_close.build_close_comment(PR_URL),
		)
		expect(git_followup_issue_close.build_close_comment(PR_URL)).toContain(PR_URL)
	})

	it('reports the repair where the run is watched', async () => {
		mocked_read.mockResolvedValue(OPEN)

		await ensure(ISSUE_NUMBER)

		expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
			expect.stringContaining(`${session_cite.issue(ISSUE_NUMBER)} is still open`),
		)
	})

	it('treats an unreadable state as open and repairs it', async () => {
		mocked_read.mockResolvedValue(undefined)

		await ensure(ISSUE_NUMBER)

		expect(mocked_close).toHaveBeenCalledOnce()
	})

	it('throws when the close itself is refused, so the guard reports it', async () => {
		mocked_read.mockResolvedValue(OPEN)
		mocked_close.mockResolvedValue(false)

		await expect(ensure(ISSUE_NUMBER)).rejects.toThrow(
			`could not close issue ${session_cite.issue(ISSUE_NUMBER)}`,
		)
	})
})
