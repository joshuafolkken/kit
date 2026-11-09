import { git_gh_issue_batch_graphql, type BatchRead } from '#scripts/gh/git-gh-issue-batch-graphql'
import { listing_outcome } from '#scripts/gh/git-gh-issue-list-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { close_completed_epics } from './epic-close'

// joshuafolkken/kit#6869: the children are read the batched way — one GraphQL query per repository
// answers what it can, and only a child it left unanswered costs a REST read.

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		issue_list_by_label: vi.fn(),
		issue_get_state_and_relations: vi.fn(),
		issue_list_comments: vi.fn(),
		issue_close: vi.fn(),
	},
}))

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const mocked_list = vi.mocked(git_gh_command.issue_list_by_label)
const mocked_get_child = vi.mocked(git_gh_command.issue_get_state_and_relations)
const mocked_close = vi.mocked(git_gh_command.issue_close)

const EPIC_BODY = '## Progress\n\n- [ ] #101 one\n- [ ] #102 two\n- [ ] #103 three\n'
const MERGED = { issue_number: '103', is_merged: true }

function child_json(state: string): string {
	return JSON.stringify({ state, blockedBy: { totalCount: 0 } })
}

// The batch answers each of `answered` as a closed child.
function batch_answering(answered: ReadonlyArray<number>): BatchRead {
	const reads = answered.map(
		(issue_number) =>
			[issue_number, git_gh_issue_batch_graphql.answered(child_json('CLOSED'))] as const,
	)

	return { reads: new Map(reads), cost: 1, remaining: undefined }
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	mocked_list.mockResolvedValue(listing_outcome(JSON.stringify([{ number: 200, body: EPIC_BODY }])))
	mocked_close.mockResolvedValue(true)
})

describe('close_completed_epics — children read in one batch', () => {
	it('closes the epic on the batch answer alone, with no REST read', async () => {
		vi.spyOn(git_gh_issue_batch_graphql, 'read_many').mockResolvedValue(batch_answering([101, 102]))

		await close_completed_epics(MERGED)

		expect(mocked_get_child).not.toHaveBeenCalled()
		expect(mocked_close).toHaveBeenCalledWith('200', expect.anything())
	})

	it('reads through REST only the child the batch left unanswered', async () => {
		vi.spyOn(git_gh_issue_batch_graphql, 'read_many').mockResolvedValue(batch_answering([101]))
		mocked_get_child.mockResolvedValue(child_json('CLOSED'))

		await close_completed_epics(MERGED)

		expect(mocked_get_child.mock.calls).toEqual([['102', undefined]])
		expect(mocked_close).toHaveBeenCalledWith('200', expect.anything())
	})

	it('still leaves the epic open when the REST read of the unanswered child fails', async () => {
		vi.spyOn(git_gh_issue_batch_graphql, 'read_many').mockResolvedValue(batch_answering([101]))
		mocked_get_child.mockResolvedValue(undefined)

		await close_completed_epics(MERGED)

		expect(mocked_close).not.toHaveBeenCalled()
	})
})
