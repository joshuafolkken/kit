import { git_gh_etag_read } from '#scripts/gh/git-gh-etag-read'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { TRANSPORT_ENV_VAR } from '#scripts/gh/git-gh-transport'
import { ALREADY_DONE_LABEL } from '#scripts/issue/issue-labels'
import { issue_merged } from '#scripts/issue/issue-merged'
import { issue_outcome } from '#scripts/issue/issue-outcome'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_closed } from './run-board-closed'

// joshuafolkken/kit#3451: a child that left the open listing, read from GitHub — its title, when it
// closed, and whether a merged pull request closed it.

vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_view_json: vi.fn() },
}))
vi.mock('#scripts/issue/issue-merged', () => ({ issue_merged: { read_merge_state: vi.fn() } }))

const CLOSED_AT = '2026-10-08T08:45:48Z'
const TITLE = 'Show closed children'

afterEach(() => vi.restoreAllMocks())

function view(state: string, state_reason?: string): string {
	return JSON.stringify({
		title: TITLE,
		state,
		stateReason: state_reason,
		closedAt: state === 'CLOSED' ? CLOSED_AT : undefined,
		labels: [{ name: 'bug' }, { name: 'auto-ok' }],
	})
}

beforeEach(() => {
	vi.mocked(git_gh_issue_read.issue_view_json).mockReset()
	vi.mocked(issue_merged.read_merge_state).mockReset()
	// The REST reads; the GraphQL read is `run-board-closed-graphql.test.ts`'s.
	vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
})

describe('run_board_closed.read_closed', () => {
	it('reads the outcome only for an issue closed without a merge', async () => {
		const outcome = {
			summary: 'No change needed',
			url: 'https://github.com/o/r/issues/3439#issuecomment-1',
		}
		const read = vi.spyOn(issue_outcome, 'recorded').mockResolvedValue({ outcome })

		vi.mocked(git_gh_issue_read.issue_view_json).mockResolvedValue(view('CLOSED'))
		vi.mocked(issue_merged.read_merge_state).mockResolvedValue(false)

		await expect(run_board_closed.read_closed(3439)).resolves.toMatchObject({ outcome })
		expect(read).toHaveBeenCalledWith(3439, false)
	})
	it.each([true, false])('reads a closed issue, merged %s', async (is_merged) => {
		vi.mocked(git_gh_issue_read.issue_view_json).mockResolvedValue(view('CLOSED'))
		vi.mocked(issue_merged.read_merge_state).mockResolvedValue(is_merged)

		await expect(run_board_closed.read_closed(3439)).resolves.toStrictEqual({
			title: TITLE,
			labels: ['bug', 'auto-ok'],
			closed_ms: Date.parse(CLOSED_AT),
			is_merged,
			is_not_planned: false,
		})
		expect(git_gh_issue_read.issue_view_json).toHaveBeenCalledWith(
			'3439',
			'title,state,stateReason,closedAt,labels',
			undefined,
			git_gh_etag_read.read,
		)
	})
})

// joshuafolkken/kit#3958: a child a person closed as not planned is drawn withdrawn.
describe('run_board_closed.read_closed — the close reason', () => {
	it.each<[string, boolean]>([
		['not_planned', true],
		['completed', false],
		['duplicate', false],
	])('reads a close as %s as not planned %s', async (reason, is_not_planned) => {
		vi.mocked(git_gh_issue_read.issue_view_json).mockResolvedValue(view('CLOSED', reason))
		vi.mocked(issue_merged.read_merge_state).mockResolvedValue(false)

		await expect(run_board_closed.read_closed(3439)).resolves.toMatchObject({ is_not_planned })
	})
})

describe('run_board_closed.read_closed — an issue not read closed', () => {
	it('answers still open for an open issue, without asking whether it merged', async () => {
		vi.mocked(git_gh_issue_read.issue_view_json).mockResolvedValue(view('OPEN'))

		await expect(run_board_closed.read_closed(3439)).resolves.toBe(run_board_closed.STILL_OPEN)
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

// joshuafolkken/kit#7095: a close `josh issue:already-done` made keeps its label, and draws as ⏩.
describe('run_board_closed.state_of', () => {
	const closed = {
		title: TITLE,
		labels: [],
		closed_ms: undefined,
		is_merged: false,
		is_not_planned: false,
	}
	const labelled = { ...closed, labels: [ALREADY_DONE_LABEL] }

	it('answers already_done for a close labelled already-done (ac-38bbacca)', () => {
		expect(run_board_closed.state_of(labelled)).toBe('already_done')
	})

	it('answers done for a close with no such label (ac-b055a6a2)', () => {
		expect(run_board_closed.state_of(closed)).toBe('done')
	})

	it('lets a merge or a not-planned close outrank the label', () => {
		expect(run_board_closed.state_of({ ...labelled, is_merged: true })).toBe('merged')
		expect(run_board_closed.state_of({ ...labelled, is_not_planned: true })).toBe('withdrawn')
	})
})

describe('run_board_closed.read_all', () => {
	const closed = {
		title: TITLE,
		labels: [],
		closed_ms: undefined,
		is_merged: false,
		is_not_planned: false,
	}

	it('keeps only the issues that answered closed, whole when the rest answered open', async () => {
		const read = vi.fn(async (issue: number) =>
			issue === 1 ? closed : run_board_closed.STILL_OPEN,
		)

		const answer = await run_board_closed.read_all([1, 2], read)

		expect([...answer.closed]).toStrictEqual([[1, closed]])
		expect(answer.is_whole).toBe(true)
	})

	it('is not whole when an issue could not be read', async () => {
		const read = vi.fn(async (issue: number) => (issue === 1 ? closed : undefined))

		const answer = await run_board_closed.read_all([1, 2], read)

		expect([...answer.closed]).toStrictEqual([[1, closed]])
		expect(answer.is_whole).toBe(false)
	})
})
