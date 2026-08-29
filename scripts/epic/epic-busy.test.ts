import { auto_ok_fixture, CREATED_EARLIER } from '#scripts/auto-ok/auto-ok-fixture'
import { IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL } from '#scripts/git/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_busy } from './epic-busy'

// joshuafolkken/kit#925: the contended resource is the repository — one working tree, one `main`,
// one `package.json` that `josh bump` rewrites — and none of them cares which epic a child belongs
// to. This read is what lets `epic:next` see an `in-progress` issue the epic does not track.

vi.mock('#scripts/git/git-gh-command', () => ({
	git_gh_command: { issue_list_by_label_in_repo: vi.fn() },
}))

const { git_gh_command } = await import('#scripts/git/git-gh-command')
const issue_list = vi.mocked(git_gh_command.issue_list_by_label_in_repo)

// The listing row builder is the `auto-ok` pickup's, not a second copy of it: both read the same
// `gh issue list --json number,title,labels,createdAt` shape, and a row built two ways is what stops
// a suite pinning the behavior it was written for.
const { issue } = auto_ok_fixture

const REPO = 'joshuafolkken/kit'
const HOLDER_NUMBER = 912

function holder(): ReturnType<typeof issue> {
	return issue(HOLDER_NUMBER, CREATED_EARLIER, [IN_PROGRESS_LABEL])
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('epic_busy.read_repository', () => {
	it('asks the named repository for its in-progress issues', async () => {
		issue_list.mockResolvedValueOnce('[]')

		await epic_busy.read_repository(REPO)

		expect(issue_list).toHaveBeenCalledWith(IN_PROGRESS_LABEL, epic_busy.LISTING_LIMIT, REPO)
	})

	it('reads an empty listing as idle', async () => {
		issue_list.mockResolvedValueOnce('[]')

		expect(await epic_busy.read_repository(REPO)).toEqual({ kind: 'idle' })
	})

	it('reads any in-progress issue as busy, whichever epic it belongs to', async () => {
		issue_list.mockResolvedValueOnce(JSON.stringify([holder()]))

		const read = await epic_busy.read_repository(REPO)

		expect(read.kind).toBe('busy')
	})

	// A failed read must never read as "nothing is running": that absence starts work, which is the
	// one direction this guard may not fail in (joshuafolkken/kit#950).
	it('reads a listing that never arrived as unreadable, not as idle', async () => {
		issue_list.mockResolvedValueOnce(undefined)

		expect(await epic_busy.read_repository(REPO)).toEqual({ kind: 'unreadable' })
	})

	it('reads output that is not a listing as unreadable', async () => {
		issue_list.mockResolvedValueOnce('{"message":"API rate limit exceeded"}')

		expect(await epic_busy.read_repository(REPO)).toEqual({ kind: 'unreadable' })
	})

	it('reads a listing whose fields changed shape as unreadable', async () => {
		issue_list.mockResolvedValueOnce('[{"number":"twelve"}]')

		expect(await epic_busy.read_repository(REPO)).toEqual({ kind: 'unreadable' })
	})
})

// `park and continue` sets a child aside and moves on, and nothing removes `in-progress` when it
// does. Counting a parked issue as a holder would hand the repository to the very child the run just
// set aside — the run would poll instead of continuing, which is the property `epicrun` exists for.
describe('epic_busy.read_repository — a parked issue', () => {
	it('does not hold the repository', async () => {
		issue_list.mockResolvedValueOnce(
			JSON.stringify([
				issue(HOLDER_NUMBER, CREATED_EARLIER, [IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL]),
			]),
		)

		expect(await epic_busy.read_repository(REPO)).toEqual({ kind: 'idle' })
	})

	it('leaves a holder that is not parked holding it', async () => {
		issue_list.mockResolvedValueOnce(
			JSON.stringify([
				issue(HOLDER_NUMBER, CREATED_EARLIER, [IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL]),
				holder(),
			]),
		)

		const read = await epic_busy.read_repository(REPO)

		expect(read.kind).toBe('busy')
	})

	// GitHub keeps the spelling a label was created with, so the comparison is the one
	// `issue-labels.ts` defines rather than an equality test written here.
	it('is detected whatever case the label carries', () => {
		const parked = issue(HOLDER_NUMBER, CREATED_EARLIER, [NEEDS_DECISION_LABEL.toUpperCase()])

		expect(epic_busy.is_parked(parked)).toBe(true)
	})
})

describe('epic_busy messages', () => {
	// The stale-label rule is applied by whoever finds the label stale, and it cannot be applied to
	// an issue nobody was told about — so the holder's number is part of the answer, not decoration.
	it('names the issue holding the repository', () => {
		expect(epic_busy.busy_message([holder()], REPO)).toContain(`#${String(HOLDER_NUMBER)}`)
	})

	it('names the repository the read failed for', () => {
		expect(epic_busy.unreadable_message(REPO)).toContain(REPO)
	})

	it('says a failed read is not an idle repository', () => {
		expect(epic_busy.unreadable_message(REPO)).toContain('not "nothing is running"')
	})
})
