import { git_gh_conditional } from '#scripts/gh/git-gh-conditional'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { conditional_read_over } from '#scripts/gh/git-gh-pr-fixture'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_label_age } from './epic-label-age'

// joshuafolkken/kit#3400: how long each lane holder has carried `in-progress`, read from its issue
// timeline so `epic:next` can print it rather than a parent querying the timeline by hand.

const REPO = 'joshuafolkken/kit'
const ISSUE = 912
const OTHER_ISSUE = 913
const NOW = new Date('2026-10-09T12:00:00Z')
const TEN_MINUTES_AGO = '2026-10-09T11:50:00Z'
const TWO_HOURS_AGO = '2026-10-09T10:00:00Z'
const AT_THRESHOLD = '2026-10-09T10:30:00Z'
const TEN_MINUTES_TEXT = 'in-progress for 10 min'
const UNREAD_TEXT = 'label age unread'
const BAD_GATEWAY = 'HTTP 502'

const TIMELINE_PATH = `repos/${REPO}/issues/${String(ISSUE)}/timeline?per_page=100`
const FULL_PAGE = 100
const COMMENTED = { event: 'commented', created_at: TWO_HOURS_AGO }
const IN_PROGRESS = 'in-progress'
// The label taken off is no application of it.
const UNLABELED = { event: 'unlabeled', created_at: TEN_MINUTES_AGO, label: { name: IN_PROGRESS } }

function labeled(at: string, name = IN_PROGRESS): Record<string, unknown> {
	return { event: 'labeled', created_at: at, label: { name } }
}

// The timeline `exec_gh_api` answers, read through the conditional layer the way GitHub answers it.
// `exec_gh_api` is looked up per request because each case spies it after this runs.
function serve_timelines(): void {
	vi.spyOn(git_gh_conditional, 'read_conditional').mockImplementation(
		conditional_read_over(async (request) => await git_gh_exec.exec_gh_api(request)),
	)
}

function conditional_etags(): Array<string | undefined> {
	return vi.mocked(git_gh_conditional.read_conditional).mock.calls.map(([, etag]) => etag)
}

beforeEach(() => {
	vi.restoreAllMocks()
	shared_cache_fixture.keep_in_memory()
	serve_timelines()
})

describe('epic_label_age.read_labeled_at', () => {
	it('asks the issue timeline one page at a time', async () => {
		const exec = vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue('[]')

		await epic_label_age.read_labeled_at(ISSUE, REPO)

		expect(exec.mock.calls.map(([request]) => request)).toStrictEqual([{ path: TIMELINE_PATH }])
	})

	// A label removed and applied again is held since the newest application, not the first.
	it('answers the newest time the label was applied', async () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(
			JSON.stringify([labeled(TWO_HOURS_AGO), COMMENTED, labeled(TEN_MINUTES_AGO, 'In-Progress')]),
		)

		await expect(epic_label_age.read_labeled_at(ISSUE, REPO)).resolves.toStrictEqual({
			kind: 'at',
			at: TEN_MINUTES_AGO,
		})
	})

	it('answers absent when the timeline holds no such event', async () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(
			JSON.stringify([COMMENTED, labeled(TEN_MINUTES_AGO, 'bug'), UNLABELED]),
		)

		await expect(epic_label_age.read_labeled_at(ISSUE, REPO)).resolves.toStrictEqual({
			kind: 'absent',
		})
	})
})

describe('epic_label_age.read_labeled_at — failures and paging', () => {
	it('answers unread when the timeline request fails', async () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockRejectedValue(new Error(BAD_GATEWAY))

		await expect(epic_label_age.read_labeled_at(ISSUE, REPO)).resolves.toStrictEqual({
			kind: 'unread',
		})
	})

	it('answers unread when the timeline does not parse', async () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue('{}')

		await expect(epic_label_age.read_labeled_at(ISSUE, REPO)).resolves.toStrictEqual({
			kind: 'unread',
		})
	})

	// The conditional read cannot page, so a full first page is read again in full.
	it('reads every page when the first one is full', async () => {
		const full_page = Array.from({ length: FULL_PAGE }, () => COMMENTED)
		const exec = vi
			.spyOn(git_gh_exec, 'exec_gh_api')
			.mockResolvedValueOnce(JSON.stringify(full_page))
			.mockResolvedValueOnce(JSON.stringify([...full_page, labeled(TEN_MINUTES_AGO)]))

		await expect(epic_label_age.read_labeled_at(ISSUE, REPO)).resolves.toStrictEqual({
			kind: 'at',
			at: TEN_MINUTES_AGO,
		})
		expect(exec).toHaveBeenLastCalledWith({ path: TIMELINE_PATH, should_paginate: true })
	})
})

// joshuafolkken/kit#6636: `epic:next` offers every minute, each offer a fresh process, so the timeline
// is sent with the ETag the previous offer kept.
describe('epic_label_age.read_labeled_at — the previous ETag', () => {
	const first = JSON.stringify([COMMENTED, labeled(TWO_HOURS_AGO)])

	it('sends the previous ETag and answers the previous age on a 304', async () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(first)

		await epic_label_age.read_labeled_at(ISSUE, REPO)
		const second = await epic_label_age.read_labeled_at(ISSUE, REPO)

		expect(conditional_etags()).toStrictEqual([undefined, first])
		expect(second).toStrictEqual({ kind: 'at', at: TWO_HOURS_AGO })
	})

	it('answers the new age when the timeline changed', async () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api')
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(JSON.stringify([labeled(TWO_HOURS_AGO), labeled(TEN_MINUTES_AGO)]))

		await epic_label_age.read_labeled_at(ISSUE, REPO)

		await expect(epic_label_age.read_labeled_at(ISSUE, REPO)).resolves.toStrictEqual({
			kind: 'at',
			at: TEN_MINUTES_AGO,
		})
		expect(conditional_etags()).toStrictEqual([undefined, first])
	})
})

describe('epic_label_age.age_text', () => {
	it('prints the minutes the label has been held', () => {
		expect(epic_label_age.age_text({ kind: 'at', at: TEN_MINUTES_AGO }, NOW)).toBe(TEN_MINUTES_TEXT)
	})

	// The `Stale \`in-progress\`` row of `backlogrun-progress.md`: past its threshold the session is gone.
	it('calls a label held past the threshold stale', () => {
		expect(epic_label_age.age_text({ kind: 'at', at: TWO_HOURS_AGO }, NOW)).toBe(
			'in-progress for 120 min — stale',
		)
	})

	it('does not call a label held exactly the threshold stale', () => {
		expect(epic_label_age.age_text({ kind: 'at', at: AT_THRESHOLD }, NOW)).toBe(
			`in-progress for ${String(epic_label_age.STALE_MINUTES)} min`,
		)
	})

	it('calls a label older than the timeline stale', () => {
		expect(epic_label_age.age_text({ kind: 'absent' }, NOW)).toContain('stale')
	})

	// An unread timeline is not evidence of anything, so it is never called stale.
	it('says the age was not read rather than guessing one', () => {
		expect(epic_label_age.age_text({ kind: 'unread' }, NOW)).toBe(UNREAD_TEXT)
	})
})

describe('epic_label_age.read_ages', () => {
	it('maps each holder to its age text', async () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api')
			.mockResolvedValueOnce(JSON.stringify([COMMENTED, labeled(TEN_MINUTES_AGO)]))
			.mockRejectedValueOnce(new Error(BAD_GATEWAY))

		const ages = await epic_label_age.read_ages([ISSUE, OTHER_ISSUE], REPO, NOW)

		expect([...ages]).toStrictEqual([
			[ISSUE, TEN_MINUTES_TEXT],
			[OTHER_ISSUE, UNREAD_TEXT],
		])
	})
})
