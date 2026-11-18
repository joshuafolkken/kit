import { auto_ok_fixture, CREATED_EARLIER } from '#scripts/auto-ok/auto-ok-fixture'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { listing_of, listing_outcome } from '#scripts/gh/git-gh-issue-list-fixture'
import {
	NEEDS_DECISION_LABEL,
	RUN_SOLO_LABEL,
	RUN_STALLED_LABEL,
} from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EpicChild } from './epic-graph'
import { epic_report, type EpicNextResult } from './epic-report'
import { epic_solo } from './epic-solo'
import { epic_solo_parked } from './epic-solo-parked'

// joshuafolkken/kit#7855: a `run:solo` issue parked unmerged keeps the gate held while it is open.

const { issue } = auto_ok_fixture

const REPO = 'joshuafolkken/kit'
const PARKED = 7841
const FIRST = 7447
const SECOND = 7806

function child(number: number): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [], blocked_by: [] }
}

function result(): EpicNextResult {
	return {
		verdict: 'run',
		candidates: [{ repo: REPO, children: [child(FIRST), child(SECOND)] }],
		waiting: [],
		blocked_on_people: [],
		anomalies: [],
	}
}

function solo_rows(labels: ReadonlyArray<string>): void {
	vi.spyOn(git_gh_command, 'issue_list_by_label_in_repo').mockResolvedValue(
		listing_of([issue(PARKED, CREATED_EARLIER, [RUN_SOLO_LABEL, ...labels])]),
	)
}

beforeEach(() => {
	vi.restoreAllMocks()
})

describe('epic_solo_parked.notice', () => {
	it('names a parked run:solo issue and how the gate resumes', async () => {
		solo_rows([RUN_STALLED_LABEL])

		const notice = await epic_solo_parked.notice(REPO)

		expect(notice).toContain(`#${String(PARKED)}`)
		expect(notice).toContain('merges, is closed, or has `run:solo` removed')
		expect(epic_solo.is_solo_wait(notice ?? '')).toBe(true)
	})

	it('holds for any park label, a person’s decision included', async () => {
		solo_rows([NEEDS_DECISION_LABEL])

		expect(await epic_solo_parked.notice(REPO)).toContain(`#${String(PARKED)}`)
	})

	it('holds nothing for a run:solo issue with no park label', async () => {
		solo_rows([])

		expect(await epic_solo_parked.notice(REPO)).toBeUndefined()
	})

	it('holds nothing once no open issue carries run:solo', async () => {
		vi.spyOn(git_gh_command, 'issue_list_by_label_in_repo').mockResolvedValue(listing_of([]))

		expect(await epic_solo_parked.notice(REPO)).toBeUndefined()
	})

	it('holds when the run:solo listing could not be read', async () => {
		vi.spyOn(git_gh_command, 'issue_list_by_label_in_repo').mockResolvedValue(
			listing_outcome(undefined),
		)

		expect(await epic_solo_parked.notice(REPO)).toContain('cannot be ruled out')
	})
})

describe('epic_solo_parked.hold', () => {
	it('withholds every candidate while a parked run:solo issue is open', async () => {
		solo_rows([RUN_STALLED_LABEL])

		const held = await epic_solo_parked.hold(result(), REPO)

		expect(held?.result.candidates.flatMap((bundle) => bundle.children)).toEqual([])
		expect(held?.result.waiting.map((entry) => entry.number)).toEqual([FIRST, SECOND])
		expect(held?.notice).toContain(`#${String(PARKED)}`)
	})

	it('leaves the offer to the gate once run:solo is removed', async () => {
		vi.spyOn(git_gh_command, 'issue_list_by_label_in_repo').mockResolvedValue(listing_of([]))

		expect(await epic_solo_parked.hold(result(), REPO)).toBeUndefined()
		expect(epic_report.candidates_for_repo(result(), REPO)).toHaveLength(2)
	})

	it('reads nothing for an answer that offers nothing', async () => {
		const list = vi.spyOn(git_gh_command, 'issue_list_by_label_in_repo')

		expect(await epic_solo_parked.hold({ ...result(), verdict: 'wait' }, REPO)).toBeUndefined()
		expect(list).not.toHaveBeenCalled()
	})
})
