import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4560: a child `run:merge` counts as merged closes its epics whatever closed it —
// a merge GitHub left OPEN, or a close outside `followup` (`already-done`, `josh issue:measured`).

const { ensure_issue_closed, close_completed_epics } = vi.hoisted(() => ({
	ensure_issue_closed: vi.fn<() => Promise<void>>(),
	close_completed_epics: vi.fn<() => Promise<void>>(),
}))

vi.mock('#scripts/followup/git-followup-issue-close', () => ({
	git_followup_issue_close: { ensure_issue_closed, CLOSE_RECOVERY: 'recover' },
}))
vi.mock('#scripts/epic/epic-close', () => ({ epic_close: { close_completed_epics } }))

const { run_merge_close } = await import('./run-merge-close')

const CHILD = '4408'
const PR_URL = 'https://github.com/joshuafolkken/kit/pull/4535'
const CLOSED_CHILD = { issue_number: CHILD, is_merged: true }

beforeEach(() => {
	ensure_issue_closed.mockReset().mockResolvedValue(undefined)
	close_completed_epics.mockReset().mockResolvedValue(undefined)
	vi.spyOn(console, 'error').mockReturnValue()
})

describe('run_merge_close.close_merged — the epic close for every merged child', () => {
	it('closes the epics of a child closed outside followup, with no close of its own', async () => {
		await run_merge_close.close_merged({ child: CHILD })

		expect(ensure_issue_closed).not.toHaveBeenCalled()
		expect(close_completed_epics).toHaveBeenCalledWith(CLOSED_CHILD)
	})

	it('closes a child GitHub left OPEN, then its epics', async () => {
		await run_merge_close.close_merged({ child: CHILD, merged_pr: PR_URL })

		expect(ensure_issue_closed).toHaveBeenCalledWith(
			{ issue_number: CHILD, pr_url: PR_URL, closer: 'pnpm josh run:merge' },
			expect.anything(),
		)
		expect(close_completed_epics).toHaveBeenCalledWith(CLOSED_CHILD)
	})

	it("keeps the epic close's notes off stdout, which carries only the verdict", async () => {
		const info = vi.spyOn(console, 'info').mockReturnValue()
		const note = '🏁 Closed epic'

		close_completed_epics.mockImplementation(async () => {
			console.info(note)
			await Promise.resolve()
		})

		await run_merge_close.close_merged({ child: CHILD })
		console.info('verdict')

		expect(console.error).toHaveBeenCalledWith(note)
		expect(info.mock.calls).toStrictEqual([['verdict']])
	})

	it('leaves the epics alone when the child could not be closed', async () => {
		ensure_issue_closed.mockRejectedValue(new Error('HTTP 502'))

		await run_merge_close.close_merged({ child: CHILD, merged_pr: PR_URL })

		expect(close_completed_epics).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('could not be closed'))
	})
})
