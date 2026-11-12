import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_triage_unblock } from './backlog-triage-unblock'

vi.mock('#scripts/epic/epic-blocked-by', () => ({ epic_blocked_by: { listing_epics: vi.fn() } }))
vi.mock('#scripts/epic/epic-read', () => ({ epic_read: { read_epic: vi.fn() } }))
vi.mock('#scripts/epic/epic-remove', () => ({ epic_remove: { remove_order: vi.fn() } }))
vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_remove_blocked_by: vi.fn() },
}))

const { epic_blocked_by } = await import('#scripts/epic/epic-blocked-by')
const { epic_read } = await import('#scripts/epic/epic-read')
const { epic_remove } = await import('#scripts/epic/epic-remove')
const { git_gh_issue_write } = await import('#scripts/gh/git-gh-issue-write')
const listing_epics = vi.mocked(epic_blocked_by.listing_epics)
const read_epic = vi.mocked(epic_read.read_epic)
const remove_order = vi.mocked(epic_remove.remove_order)
const remove_relation = vi.mocked(git_gh_issue_write.issue_remove_blocked_by)

const ISSUE = 5767
const BLOCKER = 5562
const EPIC = 5760
const SECOND_EPIC = 5761
const DECLARED = `- #${String(BLOCKER)} -> #${String(ISSUE)}`
const REQUEST = { issue: String(ISSUE), prerequisite: String(BLOCKER) }
const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0

function epic_body(declaration: string): string {
	return [
		'## Progress',
		'',
		`- [ ] #${String(BLOCKER)}`,
		`- [ ] #${String(ISSUE)}`,
		'',
		'## Dependencies',
		'',
		declaration,
	].join('\n')
}

function reading_of(declaration: string): Awaited<ReturnType<typeof epic_read.read_epic>> {
	return {
		subject: { number: EPIC, labels: ['epic'], body: epic_body(declaration) },
		recorded: [],
		repo: 'joshuafolkken/kit',
	}
}

beforeEach(() => {
	listing_epics.mockResolvedValue([EPIC])
	read_epic.mockResolvedValue(reading_of(DECLARED))
	remove_order.mockResolvedValue(SUCCESS_EXIT_CODE)
	remove_relation.mockResolvedValue(true)
})

describe('backlog_triage_unblock.remove', () => {
	it('drops the declaration of a tracking epic, then deletes the relation', async () => {
		await backlog_triage_unblock.remove(REQUEST)

		expect(remove_order).toHaveBeenCalledWith({ epic_number: EPIC, path: [BLOCKER, ISSUE] })
		expect(remove_relation).toHaveBeenCalledWith(String(ISSUE), String(BLOCKER))
	})

	it('drops the declaration from every epic listing the issue', async () => {
		listing_epics.mockResolvedValueOnce([EPIC, SECOND_EPIC])

		await backlog_triage_unblock.remove(REQUEST)

		expect(read_epic.mock.calls).toStrictEqual([[EPIC], [SECOND_EPIC]])
		expect(remove_order).toHaveBeenCalledWith({ epic_number: SECOND_EPIC, path: [BLOCKER, ISSUE] })
		expect(remove_order).toHaveBeenCalledTimes(2)
	})

	it('writes no epic when no epic tracks the issue', async () => {
		listing_epics.mockResolvedValueOnce([])

		await backlog_triage_unblock.remove(REQUEST)

		expect(read_epic).not.toHaveBeenCalled()
		expect(remove_order).not.toHaveBeenCalled()
		expect(remove_relation).toHaveBeenCalledWith(String(ISSUE), String(BLOCKER))
	})

	it.each([
		['another blocker', '- #5700 -> #5767'],
		['the reverse order', `- #${String(ISSUE)} -> #${String(BLOCKER)}`],
	])('writes no epic when the tracking epic declares %s', async (_case, declaration) => {
		read_epic.mockResolvedValueOnce(reading_of(declaration))

		await backlog_triage_unblock.remove(REQUEST)

		expect(remove_order).not.toHaveBeenCalled()
		expect(remove_relation).toHaveBeenCalledOnce()
	})
})

describe('backlog_triage_unblock.remove — a failed write', () => {
	it('names the epic write and deletes nothing when the declaration cannot be dropped', async () => {
		remove_order.mockResolvedValueOnce(FAILURE_EXIT_CODE)

		await expect(backlog_triage_unblock.remove(REQUEST)).rejects.toThrow(
			`/issues/${String(EPIC)}) failed to drop`,
		)
		expect(remove_relation).not.toHaveBeenCalled()
	})

	it('names the relation write when the relation cannot be deleted', async () => {
		remove_relation.mockResolvedValueOnce(false)

		await expect(backlog_triage_unblock.remove(REQUEST)).rejects.toThrow(
			'the blocked-by relation was not removed',
		)
	})

	it('names the epic read when the tracking epic cannot be read', async () => {
		read_epic.mockResolvedValueOnce({ error: 'offline' })

		await expect(backlog_triage_unblock.remove(REQUEST)).rejects.toThrow('could not be read')
		expect(remove_relation).not.toHaveBeenCalled()
	})
})
