import type { IssueListOutcome } from '#scripts/gh/git-gh-issue-list'
import { listing_outcome } from '#scripts/gh/git-gh-issue-list-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { close_completed_epics } from './epic-close'

// joshuafolkken/kit#4564: `run:merge` parks an OPEN `already-done` child, and a person later closes
// it by hand. When it was the epic's last open child, no josh path re-evaluated that epic, so it
// stayed open. The next close of any child now sweeps every open epic the cascade did not reach.

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
const mocked_comments = vi.mocked(git_gh_command.issue_list_comments)
const mocked_close = vi.mocked(git_gh_command.issue_close)

// The merged child belongs to no listed epic: it is some other batch's child.
const MERGED = { issue_number: '900', is_merged: true }
// The `already-done` child a person closed by hand after `run:merge` parked it.
const HAND_CLOSED = '12'
const OPEN_CHILD = '13'

function child_json(state: string): string {
	return JSON.stringify({ state, blockedBy: { totalCount: 0 } })
}

function epic_listing(
	entries: Array<{ number: number; children: Array<number>; stateReason?: string }>,
): IssueListOutcome {
	const rows = entries.map((entry) => ({
		number: entry.number,
		body: entry.children.map((child) => `- [ ] #${String(child)} child`).join('\n'),
		stateReason: entry.stateReason,
	}))

	return listing_outcome(JSON.stringify(rows))
}

function closed_numbers(): Array<string | undefined> {
	return mocked_close.mock.calls.map(([number]) => number)
}

beforeEach(() => {
	vi.clearAllMocks()
	mocked_close.mockResolvedValue(true)
	mocked_comments.mockResolvedValue('[]')
	mocked_get_child.mockImplementation(async (number) =>
		child_json(number === OPEN_CHILD ? 'OPEN' : 'CLOSED'),
	)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

describe('close_completed_epics — sweep of epics the merged child is not in', () => {
	it('closes an epic whose last child a person closed after run:merge parked it', async () => {
		mocked_list.mockResolvedValue(
			epic_listing([{ number: 10, children: [11, Number(HAND_CLOSED)] }]),
		)

		await close_completed_epics(MERGED)

		expect(closed_numbers()).toEqual(['10'])
	})

	it('leaves an epic with an open child open', async () => {
		mocked_list.mockResolvedValue(
			epic_listing([{ number: 10, children: [11, Number(OPEN_CHILD)] }]),
		)

		await close_completed_epics(MERGED)

		expect(closed_numbers()).toEqual([])
	})

	it('leaves an epic that lists no child open', async () => {
		mocked_list.mockResolvedValue(epic_listing([{ number: 10, children: [] }]))

		await close_completed_epics(MERGED)

		expect(closed_numbers()).toEqual([])
	})
})

// A person reopening a finished epic has said it is not done; the sweep must not override that.
describe('close_completed_epics — sweep of a reopened epic', () => {
	it('leaves an epic a person reopened open', async () => {
		mocked_list.mockResolvedValue(
			epic_listing([{ number: 10, children: [11], stateReason: 'reopened' }]),
		)

		await close_completed_epics(MERGED)

		expect(closed_numbers()).toEqual([])
	})

	it('still closes a reopened epic when one of its own children closes', async () => {
		mocked_list.mockResolvedValue(
			epic_listing([
				{ number: 10, children: [11, Number(MERGED.issue_number)], stateReason: 'reopened' },
			]),
		)

		await close_completed_epics(MERGED)

		expect(closed_numbers()).toEqual(['10'])
	})
})

describe('close_completed_epics — sweep cascade', () => {
	it('cascades to a parent the sweep read before its child epic closed', async () => {
		mocked_list.mockResolvedValue(
			epic_listing([
				{ number: 30, children: [20] },
				{ number: 20, children: [Number(HAND_CLOSED)] },
			]),
		)
		mocked_get_child.mockImplementation(async (number) =>
			child_json(number === '20' ? 'OPEN' : 'CLOSED'),
		)

		await close_completed_epics(MERGED)

		expect(closed_numbers()).toEqual(['20', '30'])
	})
})
