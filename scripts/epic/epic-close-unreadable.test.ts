import { listing_outcome } from '#scripts/gh/git-gh-issue-list-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { close_completed_epics } from './epic-close'

// joshuafolkken/kit#4560: an unreadable child asks for a manual close only once every child that was
// read is closed — while one is still open the batch is unfinished, and the request would invite
// closing it early.
//
// Kept out of `epic-close.test.ts` because that suite is already at its file-length ceiling.

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
const UNREADABLE_NOTE = 'state could not be read;'

function child_json(state: string): string {
	return JSON.stringify({ state, blockedBy: { totalCount: 0 } })
}

function unreadable_notes(): Array<string> {
	return vi
		.mocked(console.info)
		.mock.calls.map(([line]) => String(line))
		.filter((line) => line.includes(UNREADABLE_NOTE))
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	mocked_list.mockResolvedValue(listing_outcome(JSON.stringify([{ number: 200, body: EPIC_BODY }])))
})

describe('close_completed_epics — a child whose state could not be read', () => {
	it.each([
		{ when: 'asks for a manual close once the other child is closed', other: 'CLOSED', count: 1 },
		{ when: 'asks for nothing while the other child is still open', other: 'OPEN', count: 0 },
	])('leaves the epic open and $when', async ({ other, count }) => {
		mocked_get_child.mockResolvedValueOnce(child_json(other)).mockResolvedValueOnce(undefined)

		await close_completed_epics({ issue_number: '103', is_merged: true })

		expect(mocked_close).not.toHaveBeenCalled()
		expect(unreadable_notes()).toHaveLength(count)
	})

	it('reads an answer carrying no state as unreadable, not as an open child', async () => {
		mocked_get_child
			.mockResolvedValueOnce(child_json('CLOSED'))
			.mockResolvedValueOnce(JSON.stringify({ blockedBy: { totalCount: 0 } }))

		await close_completed_epics({ issue_number: '103', is_merged: true })

		expect(mocked_close).not.toHaveBeenCalled()
		expect(unreadable_notes()).toHaveLength(1)
	})
})
