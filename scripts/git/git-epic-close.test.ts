import { beforeEach, describe, expect, it, vi } from 'vitest'
import { close_completed_epics } from './git-epic-close'

vi.mock('./git-gh-command', () => ({
	git_gh_command: {
		issue_list_by_label: vi.fn(),
		issue_get_state_and_relations: vi.fn(),
		issue_close: vi.fn(),
	},
}))

const { git_gh_command } = await import('./git-gh-command')
const mocked_list = vi.mocked(git_gh_command.issue_list_by_label)
const mocked_get_child = vi.mocked(git_gh_command.issue_get_state_and_relations)
const mocked_close = vi.mocked(git_gh_command.issue_close)

const EPIC_BODY = '## Progress\n\n- [ ] #101 one\n- [ ] #102 two\n- [ ] #103 three\n'
const MERGED_ISSUE = '103'

function epic_list_json(entries: Array<{ number: number; body: string }>): string {
	return JSON.stringify(entries)
}

function child_json(input: { state: string; blocked_by?: number }): string {
	return JSON.stringify({ state: input.state, blockedBy: { totalCount: input.blocked_by ?? 0 } })
}

const CLOSED_UNLINKED = child_json({ state: 'CLOSED' })
const CLOSED_LINKED = child_json({ state: 'CLOSED', blocked_by: 1 })

beforeEach(() => {
	vi.clearAllMocks()
	mocked_close.mockResolvedValue(true)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

describe('close_completed_epics — completed batch', () => {
	it('closes the epic with a comment naming every child', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: EPIC_BODY }]))
		mocked_get_child.mockResolvedValue(CLOSED_UNLINKED)

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })

		expect(mocked_close).toHaveBeenCalledTimes(1)

		const [closed_number, comment] = mocked_close.mock.calls[0] ?? []

		expect(closed_number).toBe('200')
		expect(comment).toContain('#101, #102, #103')
	})

	it('never queries the state of the just-merged issue', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: EPIC_BODY }]))
		mocked_get_child.mockResolvedValue(CLOSED_UNLINKED)

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })

		const queried = mocked_get_child.mock.calls.map(([number]) => number)

		expect(queried).toEqual(['101', '102'])
		expect(queried).not.toContain(MERGED_ISSUE)
	})
})

describe('close_completed_epics — incomplete batch', () => {
	it('leaves the epic open when a sibling is still open', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: EPIC_BODY }]))
		mocked_get_child.mockImplementation(async (number) =>
			child_json({ state: number === '101' ? 'OPEN' : 'CLOSED' }),
		)

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })

		expect(mocked_close).not.toHaveBeenCalled()
	})

	it('leaves the epic open when a sibling state cannot be read', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: EPIC_BODY }]))
		mocked_get_child.mockResolvedValue(undefined)

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })

		expect(mocked_close).not.toHaveBeenCalled()
	})
})

describe('close_completed_epics — cross-repository children', () => {
	it('leaves the epic open when a child lives in another repository', async () => {
		const body = '## Progress\n\n- [ ] #103 merged\n- [ ] joshuafolkken/app-kit#7 remote\n'

		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body }]))

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })

		expect(mocked_get_child).not.toHaveBeenCalled()
		expect(mocked_close).not.toHaveBeenCalled()
	})
})

describe('close_completed_epics — issue lookup', () => {
	it('requests an explicit row limit so older epics are not silently dropped', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: EPIC_BODY }]))
		mocked_get_child.mockResolvedValue(CLOSED_UNLINKED)

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })

		const [label, limit] = mocked_list.mock.calls[0] ?? []

		expect(label).toBe('epic')
		expect(limit).toBeGreaterThan(30)
	})
})

describe('close_completed_epics — no-op cases', () => {
	it('does nothing when no epic references the merged issue', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: '- [ ] #900 unrelated\n' }]))

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })

		expect(mocked_get_child).not.toHaveBeenCalled()
		expect(mocked_close).not.toHaveBeenCalled()
	})

	it('does nothing when there is no linked issue number', async () => {
		await close_completed_epics({ issue_number: undefined, is_merged: true })

		expect(mocked_list).not.toHaveBeenCalled()
		expect(mocked_close).not.toHaveBeenCalled()
	})

	it('does nothing when the issue number is not numeric', async () => {
		await close_completed_epics({ issue_number: 'not-a-number', is_merged: true })

		expect(mocked_list).not.toHaveBeenCalled()
	})

	it('does nothing when the epic label lookup is unavailable', async () => {
		mocked_list.mockResolvedValue(undefined)

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })

		expect(mocked_close).not.toHaveBeenCalled()
	})

	it('does nothing when the label lookup returns malformed json', async () => {
		mocked_list.mockResolvedValue('{not json')

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })

		expect(mocked_close).not.toHaveBeenCalled()
	})
})

describe('close_completed_epics — failure handling', () => {
	it('resolves without throwing when a gh call rejects', async () => {
		mocked_list.mockRejectedValue(new Error('gh exploded'))

		await expect(
			close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true }),
		).resolves.toBeUndefined()
	})

	it('resolves without throwing when the close call reports failure', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: EPIC_BODY }]))
		mocked_get_child.mockResolvedValue(CLOSED_UNLINKED)
		mocked_close.mockResolvedValue(false)

		await expect(
			close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true }),
		).resolves.toBeUndefined()
	})
})

describe('close_completed_epics — unrecorded batch order', () => {
	const NO_RELATION_REGEX = /no blocked-by relation on any child/u

	it('reports when no sibling carries a blocked-by relation', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: EPIC_BODY }]))
		mocked_get_child.mockResolvedValue(CLOSED_UNLINKED)

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })

		expect(console.info).toHaveBeenCalledWith(expect.stringMatching(NO_RELATION_REGEX))
	})

	it('stays silent when at least one sibling carries a relation', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: EPIC_BODY }]))
		mocked_get_child.mockImplementation(async (number) =>
			number === '102' ? CLOSED_LINKED : CLOSED_UNLINKED,
		)

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })

		expect(console.info).not.toHaveBeenCalledWith(expect.stringMatching(NO_RELATION_REGEX))
	})

	it('reports even while the batch is still incomplete, so it can still be acted on', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: EPIC_BODY }]))
		mocked_get_child.mockResolvedValue(child_json({ state: 'OPEN' }))

		await close_completed_epics({ issue_number: '101', is_merged: true })

		expect(console.info).toHaveBeenCalledWith(expect.stringMatching(NO_RELATION_REGEX))
		expect(mocked_close).not.toHaveBeenCalled()
	})
})

describe('close_completed_epics — unmerged run', () => {
	it('does nothing when the PR was not merged', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: EPIC_BODY }]))
		mocked_get_child.mockResolvedValue(CLOSED_UNLINKED)

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: false })

		expect(mocked_list).not.toHaveBeenCalled()
		expect(mocked_close).not.toHaveBeenCalled()
	})
})
