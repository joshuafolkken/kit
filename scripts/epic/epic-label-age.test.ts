import { git_gh_exec } from '#scripts/gh/git-gh-exec'
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

beforeEach(() => {
	vi.restoreAllMocks()
})

describe('epic_label_age.read_labeled_at', () => {
	it('asks the issue timeline for the in-progress labeled events, every page', async () => {
		const exec = vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue('')

		await epic_label_age.read_labeled_at(ISSUE, REPO)

		const [request] = exec.mock.calls[0] ?? []

		expect(request?.path).toBe(`repos/${REPO}/issues/${String(ISSUE)}/timeline?per_page=100`)
		expect(request?.should_paginate).toBe(true)
		expect(request?.jq_filter).toContain('"labeled"')
	})

	// A label removed and applied again is held since the newest application, not the first.
	it('answers the newest time the label was applied', async () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(`${TWO_HOURS_AGO}\n${TEN_MINUTES_AGO}\n`)

		await expect(epic_label_age.read_labeled_at(ISSUE, REPO)).resolves.toStrictEqual({
			kind: 'at',
			at: TEN_MINUTES_AGO,
		})
	})

	it('answers absent when the timeline holds no such event', async () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue('\n')

		await expect(epic_label_age.read_labeled_at(ISSUE, REPO)).resolves.toStrictEqual({
			kind: 'absent',
		})
	})

	it('answers unread when the timeline request fails', async () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockRejectedValue(new Error(BAD_GATEWAY))

		await expect(epic_label_age.read_labeled_at(ISSUE, REPO)).resolves.toStrictEqual({
			kind: 'unread',
		})
	})
})

describe('epic_label_age.age_text', () => {
	it('prints the minutes the label has been held', () => {
		expect(epic_label_age.age_text({ kind: 'at', at: TEN_MINUTES_AGO }, NOW)).toBe(TEN_MINUTES_TEXT)
	})

	// The `Stale \`in-progress\`` row of `backlogrun-progress.md`: past 90 minutes the session is gone.
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
			.mockResolvedValueOnce(TEN_MINUTES_AGO)
			.mockRejectedValueOnce(new Error(BAD_GATEWAY))

		const ages = await epic_label_age.read_ages([ISSUE, OTHER_ISSUE], REPO, NOW)

		expect([...ages]).toStrictEqual([
			[ISSUE, TEN_MINUTES_TEXT],
			[OTHER_ISSUE, UNREAD_TEXT],
		])
	})
})
