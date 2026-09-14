import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CASCADE_DEPTH_NOTE, close_completed_epics, MAX_CASCADE_DEPTH } from './git-epic-close'
import type { IssueListOutcome } from './git-gh-issue-list'
import { listing_outcome } from './git-gh-issue-list-fixture'

// joshuafolkken/kit#2008: a nested epic. When a child epic closed, the epic that listed *it* was
// never re-evaluated, so a parent stayed open with every child already closed. The cascade re-runs
// the completion check with each closed epic as the merged child, up the nesting.
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
const mocked_get_child = vi.mocked(git_gh_command.issue_get_state_and_relations)
const mocked_comments = vi.mocked(git_gh_command.issue_list_comments)
const mocked_close = vi.mocked(git_gh_command.issue_close)

const MERGED = { issue_number: '103', is_merged: true }

function child_json(input: { state: string }): string {
	return JSON.stringify({ state: input.state, blockedBy: { totalCount: 0 } })
}

const CLOSED_UNLINKED = child_json({ state: 'CLOSED' })

function unordered_epic_body(children: Array<number>): string {
	const lines = children.map((child) => `- [ ] #${String(child)} child`).join('\n')

	return `## Progress\n\n${lines}\n`
}

function nested_epics(
	entries: Array<{ number: number; children: Array<number> }>,
): IssueListOutcome {
	const rows = entries.map((entry) => ({
		number: entry.number,
		body: unordered_epic_body(entry.children),
	}))

	return listing_outcome(JSON.stringify(rows))
}

function closed_numbers(): Array<string | undefined> {
	return mocked_close.mock.calls.map(([number]) => number)
}

// A straight chain deeper than the cap: #301 lists the merged issue, and each epic lists the one
// below it, so every level closes the one above until the cap stops the walk.
function linear_chain(depth: number): Array<{ number: number; children: Array<number> }> {
	return Array.from({ length: depth }, (_, index) => ({
		number: 301 + index,
		children: [index === 0 ? 103 : 300 + index],
	}))
}

beforeEach(() => {
	vi.clearAllMocks()
	mocked_close.mockResolvedValue(true)
	mocked_comments.mockResolvedValue('[]')
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

describe('close_completed_epics — nested epic cascade', () => {
	it('closes a parent epic when closing a nested child epic completes it', async () => {
		mocked_list.mockResolvedValue(
			nested_epics([
				{ number: 300, children: [103, 301] },
				{ number: 400, children: [300, 401] },
			]),
		)
		mocked_get_child.mockResolvedValue(CLOSED_UNLINKED)

		await close_completed_epics(MERGED)

		expect(closed_numbers()).toEqual(['300', '400'])
	})

	it('cascades through three levels of nesting', async () => {
		mocked_list.mockResolvedValue(
			nested_epics([
				{ number: 300, children: [103] },
				{ number: 400, children: [300] },
				{ number: 500, children: [400] },
			]),
		)
		mocked_get_child.mockResolvedValue(CLOSED_UNLINKED)

		await close_completed_epics(MERGED)

		expect(closed_numbers()).toEqual(['300', '400', '500'])
	})
})

describe('close_completed_epics — nested epic cascade, incomplete parent', () => {
	it('leaves the parent open when it still has an open child', async () => {
		mocked_list.mockResolvedValue(
			nested_epics([
				{ number: 300, children: [103] },
				{ number: 400, children: [300, 402] },
			]),
		)
		mocked_get_child.mockImplementation(async (number) =>
			child_json({ state: number === '402' ? 'OPEN' : 'CLOSED' }),
		)

		await close_completed_epics(MERGED)

		expect(closed_numbers()).toEqual(['300'])
	})

	it('does not cascade to the parent when the child epic close fails', async () => {
		mocked_list.mockResolvedValue(
			nested_epics([
				{ number: 300, children: [103] },
				{ number: 400, children: [300] },
			]),
		)
		mocked_get_child.mockResolvedValue(CLOSED_UNLINKED)
		mocked_close.mockImplementation(async (number) => number !== '300')

		await close_completed_epics(MERGED)

		expect(closed_numbers()).toContain('300')
		expect(closed_numbers()).not.toContain('400')
	})
})

describe('close_completed_epics — nested epic cascade guards', () => {
	it('evaluates each epic once when the nesting forms a cycle', async () => {
		mocked_list.mockResolvedValue(
			nested_epics([
				{ number: 300, children: [103, 400] },
				{ number: 400, children: [300] },
			]),
		)
		mocked_get_child.mockResolvedValue(CLOSED_UNLINKED)

		await close_completed_epics(MERGED)

		expect(closed_numbers()).toEqual(['300', '400'])
	})

	it('stops cascading at the depth cap on a nesting deeper than it', async () => {
		mocked_list.mockResolvedValue(nested_epics(linear_chain(MAX_CASCADE_DEPTH + 2)))
		mocked_get_child.mockResolvedValue(CLOSED_UNLINKED)

		await close_completed_epics(MERGED)

		expect(mocked_close).toHaveBeenCalledTimes(MAX_CASCADE_DEPTH)
		expect(console.info).toHaveBeenCalledWith(CASCADE_DEPTH_NOTE)
	})
})
