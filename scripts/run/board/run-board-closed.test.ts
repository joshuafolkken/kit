import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { issue_merged } from '#scripts/issue/issue-merged'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_closed } from './run-board-closed'

// joshuafolkken/kit#3451: a child that left the open listing, read from GitHub — its title, when it
// closed, and whether a merged pull request closed it.

vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_view_json: vi.fn() },
}))
vi.mock('#scripts/issue/issue-merged', () => ({ issue_merged: { read_merge_state: vi.fn() } }))

const CLOSED_AT = '2026-10-08T08:45:48Z'
const TITLE = 'Show closed children'

function view(state: string): string {
	return JSON.stringify({
		title: TITLE,
		state,
		closedAt: state === 'CLOSED' ? CLOSED_AT : undefined,
	})
}

beforeEach(() => {
	vi.mocked(git_gh_issue_read.issue_view_json).mockReset()
	vi.mocked(issue_merged.read_merge_state).mockReset()
})

describe('run_board_closed.read_closed', () => {
	it.each([true, false])('reads a closed issue, merged %s', async (is_merged) => {
		vi.mocked(git_gh_issue_read.issue_view_json).mockResolvedValue(view('CLOSED'))
		vi.mocked(issue_merged.read_merge_state).mockResolvedValue(is_merged)

		await expect(run_board_closed.read_closed(3439)).resolves.toStrictEqual({
			title: TITLE,
			closed_ms: Date.parse(CLOSED_AT),
			is_merged,
		})
		expect(git_gh_issue_read.issue_view_json).toHaveBeenCalledWith('3439', 'title,state,closedAt')
	})

	it('answers nothing for an issue still open, without asking whether it merged', async () => {
		vi.mocked(git_gh_issue_read.issue_view_json).mockResolvedValue(view('OPEN'))

		await expect(run_board_closed.read_closed(3439)).resolves.toBeUndefined()
		expect(issue_merged.read_merge_state).not.toHaveBeenCalled()
	})

	it('answers nothing for a closed issue whose timeline could not be read, so it is asked again', async () => {
		vi.mocked(git_gh_issue_read.issue_view_json).mockResolvedValue(view('CLOSED'))
		vi.mocked(issue_merged.read_merge_state).mockResolvedValue(undefined)

		await expect(run_board_closed.read_closed(3439)).resolves.toBeUndefined()
	})

	it('answers nothing for an issue that could not be read', async () => {
		vi.mocked(git_gh_issue_read.issue_view_json).mockResolvedValue(undefined)

		await expect(run_board_closed.read_closed(3439)).resolves.toBeUndefined()
	})
})

describe('run_board_closed.read_all', () => {
	it('keeps only the issues that answered closed', async () => {
		const closed = { title: TITLE, closed_ms: undefined, is_merged: false }
		const read = vi.fn(async (issue: number) => (issue === 1 ? closed : undefined))

		const answers = await run_board_closed.read_all([1, 2], read)

		expect([...answers]).toStrictEqual([[1, closed]])
	})
})
