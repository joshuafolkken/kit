import { beforeEach, describe, expect, it, vi } from 'vitest'
import { close_completed_epics, EPIC_LIST_LIMIT, truncated_epic_list_note } from './git-epic-close'
import { capped_listing_outcome, listing_outcome } from './git-gh-issue-list-fixture'

// joshuafolkken/kit#1067: an epic past the cut is never checked for completion, and it used to go
// past in silence — the epic stayed open with nothing saying why, the same absence this file's
// `undefined`-not-`[]` handling exists to remove.
//
// Kept out of `git-epic-close.test.ts` because that suite is already at its file-length ceiling.

vi.mock('./git-gh-command', () => ({
	git_gh_command: {
		issue_list_by_label: vi.fn(),
		issue_get_state_and_relations: vi.fn(),
		issue_list_comments: vi.fn(),
		issue_close: vi.fn(),
	},
}))

const { git_gh_command } = await import('./git-gh-command')
const mocked_list = vi.mocked(git_gh_command.issue_list_by_label)

const MERGED_ISSUE = '103'
const EMPTY_LISTING = '[]'
const LISTING_SUBJECT = 'epic listing'

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

async function close_after_merge(): Promise<void> {
	await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })
}

describe('close_completed_epics — an epic listing that was cut short', () => {
	it('says so when the paging stopped before the listing ran out', async () => {
		mocked_list.mockResolvedValue(capped_listing_outcome(EMPTY_LISTING))

		await close_after_merge()

		expect(console.info).toHaveBeenCalledWith(expect.stringContaining(LISTING_SUBJECT))
	})

	it('stays silent on a listing that ran out', async () => {
		mocked_list.mockResolvedValue(listing_outcome(EMPTY_LISTING))

		await close_after_merge()

		expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining(LISTING_SUBJECT))
	})
})

// The two cuts cite different numbers: the caller's cap, which this file sets, and the paging's
// ceiling, which it does not — so a reader is sent to the knob that would actually widen the answer.
describe('truncated_epic_list_note', () => {
	it('cites the cap for the cut the cap caused', () => {
		expect(truncated_epic_list_note('row_limit')).toContain(String(EPIC_LIST_LIMIT))
	})

	it('does not cite the cap for a cut the paging caused', () => {
		expect(truncated_epic_list_note('page_ceiling')).not.toContain(String(EPIC_LIST_LIMIT))
	})

	it('says nothing about a listing that ran out', () => {
		expect(truncated_epic_list_note('none')).toBeUndefined()
	})
})
