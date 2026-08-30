import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	close_completed_epics,
	UNREADABLE_COMMENTS_NOTE,
	UNREADABLE_EPIC_LIST_MESSAGE,
} from './git-epic-close'
import { CLOSE_ANNOUNCEMENT } from './git-epic-close-comment'

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

const GH_FAILURE = 'gh exploded'
const PROGRESS = '## Progress\n\n- [ ] #101 one\n- [ ] #102 two\n- [ ] #103 three\n'
const ORDERED_DEPENDENCIES = '## Dependencies\n\n#101 -> #102 -> #103\n\n'
const UNORDERED_DEPENDENCIES = '## Dependencies\n\nNone — the children are independent.\n\n'
const EPIC_BODY = ORDERED_DEPENDENCIES + PROGRESS
const UNORDERED_EPIC_BODY = UNORDERED_DEPENDENCIES + PROGRESS
const MERGED_ISSUE = '103'
const ALL_CHILDREN = '#101, #102, #103'

function epic_list_json(entries: Array<{ number: number; body: string }>): string {
	return JSON.stringify(entries)
}

function child_json(input: { state: string; blocked_by?: number }): string {
	return JSON.stringify({ state: input.state, blockedBy: { totalCount: input.blocked_by ?? 0 } })
}

const CLOSED_UNLINKED = child_json({ state: 'CLOSED' })
const CLOSED_LINKED = child_json({ state: 'CLOSED', blocked_by: 1 })

const NO_COMMENTS = '[]'

beforeEach(() => {
	vi.clearAllMocks()
	mocked_close.mockResolvedValue(true)
	// The default is an epic nobody has announced yet, which is what every case below except the
	// re-run ones is about.
	mocked_comments.mockResolvedValue(NO_COMMENTS)
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
		expect(comment).toContain(ALL_CHILDREN)
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

// The auto-close used to bail the moment it saw a cross-repository child, because their state could
// not be read. Reading them against their own repository is the only thing that changed: an epic
// whose children are *all* readable and closed now closes, and one with a child it cannot read
// still does not (joshuafolkken/kit#864).
describe('close_completed_epics — cross-repository children', () => {
	const REMOTE_REPO = 'joshuafolkken/app-kit'
	const CROSS_REPO_BODY = `## Progress\n\n- [ ] #103 merged\n- [ ] ${REMOTE_REPO}#7 remote\n`

	it('reads the other repository child with --repo, rather than giving up', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: CROSS_REPO_BODY }]))
		mocked_get_child.mockResolvedValue(CLOSED_UNLINKED)

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })

		expect(mocked_get_child).toHaveBeenCalledWith('7', REMOTE_REPO)
	})

	it('closes the epic once every child, near and far, is closed', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: CROSS_REPO_BODY }]))
		mocked_get_child.mockResolvedValue(CLOSED_UNLINKED)

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })

		expect(mocked_close).toHaveBeenCalledTimes(1)
	})

	it('leaves the epic open when the other repository child is still open', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: CROSS_REPO_BODY }]))
		mocked_get_child.mockResolvedValue(child_json({ state: 'OPEN' }))

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })

		expect(mocked_close).not.toHaveBeenCalled()
	})

	// Closing while a child's state is unknown is exactly what the old refusal prevented.
	it('leaves the epic open when the other repository child cannot be read', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: CROSS_REPO_BODY }]))
		mocked_get_child.mockResolvedValue(undefined)

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })

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
		mocked_list.mockRejectedValue(new Error(GH_FAILURE))

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

const NO_RELATION_REGEX = /no blocked-by relation on any child/u

describe('close_completed_epics — unrecorded batch order', () => {
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

describe('close_completed_epics — unordered batch', () => {
	it('stays silent when the epic body declares no dependency chain', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: UNORDERED_EPIC_BODY }]))
		mocked_get_child.mockResolvedValue(CLOSED_UNLINKED)

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })

		expect(console.info).not.toHaveBeenCalledWith(expect.stringMatching(NO_RELATION_REGEX))
	})

	it('still closes an unordered epic once every child is closed', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: UNORDERED_EPIC_BODY }]))
		mocked_get_child.mockResolvedValue(CLOSED_UNLINKED)

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })

		expect(mocked_close).toHaveBeenCalledTimes(1)
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

describe('close_completed_epics — per-epic isolation', () => {
	const EPIC_A = { number: 200, body: EPIC_BODY }
	const EPIC_B = { number: 201, body: EPIC_BODY }

	it('evaluates the remaining epics when one of them fails', async () => {
		mocked_list.mockResolvedValue(epic_list_json([EPIC_A, EPIC_B]))
		mocked_get_child.mockResolvedValue(CLOSED_UNLINKED)
		mocked_close.mockRejectedValueOnce(new Error(GH_FAILURE)).mockResolvedValue(true)

		await close_completed_epics({ issue_number: MERGED_ISSUE, is_merged: true })

		expect(mocked_close).toHaveBeenCalledTimes(2)
		expect(mocked_close.mock.calls.at(-1)?.[0]).toBe('201')
	})
})

// joshuafolkken/kit#959: the listing was read with `parse_json_array_safe`, which answers `[]` for a
// response it could not parse — indistinguishable from "no epic is open". The auto-close then had
// nothing to close and said nothing about why, so an epic stayed open with no trace of the failure.
const MERGED = { issue_number: MERGED_ISSUE, is_merged: true }
const UNPARSEABLE_LISTING = 'not json at all'

describe('close_completed_epics — a listing that could not be read', () => {
	it('reports that the listing could not be read rather than closing nothing in silence', async () => {
		mocked_list.mockResolvedValue(UNPARSEABLE_LISTING)

		await close_completed_epics(MERGED)

		expect(console.info).toHaveBeenCalledWith(UNREADABLE_EPIC_LIST_MESSAGE)
	})

	// The rate-limit shape: valid JSON, but an object rather than a listing.
	it('reports an answer that is valid json but not a listing', async () => {
		mocked_list.mockResolvedValue('{"message":"API rate limit exceeded"}')

		await close_completed_epics(MERGED)

		expect(console.info).toHaveBeenCalledWith(UNREADABLE_EPIC_LIST_MESSAGE)
	})

	// The same absence arrives when `gh` itself failed, and it was equally silent before.
	it('reports a listing the gh call could not produce', async () => {
		mocked_list.mockResolvedValue(undefined)

		await close_completed_epics(MERGED)

		expect(console.info).toHaveBeenCalledWith(UNREADABLE_EPIC_LIST_MESSAGE)
	})

	it('never closes an epic on a listing it could not read', async () => {
		mocked_list.mockResolvedValue(UNPARSEABLE_LISTING)

		await close_completed_epics(MERGED)

		expect(mocked_close).not.toHaveBeenCalled()
	})
})

describe('close_completed_epics — a listing that is genuinely empty', () => {
	// `[]` is an answer, not a gap: no epic is open, so there is nothing to warn about.
	it('says nothing when no epic is open', async () => {
		mocked_list.mockResolvedValue('[]')

		await close_completed_epics(MERGED)

		expect(console.info).not.toHaveBeenCalledWith(UNREADABLE_EPIC_LIST_MESSAGE)
	})

	it('still closes a completed epic on a listing it could read', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: EPIC_BODY }]))
		mocked_get_child.mockResolvedValue(CLOSED_LINKED)

		await close_completed_epics(MERGED)

		expect(mocked_close).toHaveBeenCalledWith('200', expect.stringContaining(ALL_CHILDREN))
	})
})

// joshuafolkken/kit#1039: `issue_close` posts the comment and *then* changes the state, so a run
// whose comment landed and whose close was refused leaves the epic open carrying the announcement.
// The next run reached the same point and posted it again — once per attempt, for as long as the
// close kept failing. The state machine behind the check is `git-epic-close-comment.test.ts`; what
// is pinned here is what the auto-close does with its answer.
const POSTED_ANNOUNCEMENT = JSON.stringify([
	{ body: `All child issues are closed (${ALL_CHILDREN}). ${CLOSE_ANNOUNCEMENT}` },
])

function complete_epic(): void {
	mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: EPIC_BODY }]))
	mocked_get_child.mockResolvedValue(CLOSED_UNLINKED)
}

describe('close_completed_epics — a re-run after a partial close', () => {
	// The whole sequence: the first run's comment lands and its close is refused, the second run finds
	// the comment it left behind and closes without posting a second copy.
	it('posts the announcement exactly once across a failed run and its retry', async () => {
		complete_epic()
		mocked_close.mockResolvedValueOnce(false)

		await close_completed_epics(MERGED)
		mocked_comments.mockResolvedValue(POSTED_ANNOUNCEMENT)
		await close_completed_epics(MERGED)

		const posted = mocked_close.mock.calls.filter(([, comment]) => comment !== undefined)

		expect(posted).toHaveLength(1)
		expect(mocked_close).toHaveBeenLastCalledWith('200', undefined)
	})

	// One request, and only on a run that has already found every child closed. An incomplete batch
	// never gets that far, which is what keeps the ordinary `josh followup` run costing nothing.
	it('never reads the comments of an epic whose batch is incomplete', async () => {
		mocked_list.mockResolvedValue(epic_list_json([{ number: 200, body: EPIC_BODY }]))
		mocked_get_child.mockResolvedValue(child_json({ state: 'OPEN' }))

		await close_completed_epics(MERGED)

		expect(mocked_comments).not.toHaveBeenCalled()
	})
})

// Nothing re-triggers the auto-close once every child is closed, so refusing here would strand a
// finished epic on one rate-limited read. Announcing twice costs one redundant comment; the epic
// still closes, which is what ends the repetition this fix is about.
describe('close_completed_epics — comments that could not be read', () => {
	it('closes and announces anyway rather than stranding a finished epic', async () => {
		complete_epic()
		mocked_comments.mockResolvedValue(undefined)

		await close_completed_epics(MERGED)

		expect(mocked_close).toHaveBeenCalledWith('200', expect.stringContaining(ALL_CHILDREN))
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining(UNREADABLE_COMMENTS_NOTE))
	})
})
