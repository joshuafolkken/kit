import { auto_ok_fixture, CREATED_EARLIER } from '#scripts/auto-ok/auto-ok-fixture'
import { listing_outcome } from '#scripts/gh/git-gh-issue-list-fixture'
import { IN_PROGRESS_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { lane_await } from '#scripts/lane/lane-await'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_classify } from './epic-classify'
import type { EpicChild, IssueReference } from './epic-graph'
import { epic_label_age } from './epic-label-age'
import { epic_lane_offer, type LaneRequest, type RepoPool } from './epic-lane-offer'

// joshuafolkken/kit#4466: a holder whose detached ship waits on its merge keeps `in-progress` but holds
// no lane, as `backlog:drive` counts the pool.

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_list_by_label_in_repo: vi.fn() },
}))

const merge_waiting_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/lane/lane-snapshot-trace', () => ({
	lane_snapshot_trace: { count_merge_waiting: merge_waiting_mock },
}))

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const issue_list = vi.mocked(git_gh_command.issue_list_by_label_in_repo)

const { issue } = auto_ok_fixture

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const HOLDER = 700
const OTHER_HOLDER = 701
const FIRST = 861
const SECOND = 862
const ONE_LANE = 1
const TWO_LANES = 2

function child(number: number, repo: string): EpicChild {
	return { number, repo, state: 'OPEN', labels: [RUN_LANE_LABEL], blocked_by: [] }
}

async function no_blockers(): Promise<Array<IssueReference>> {
	return []
}

function pool(children: ReadonlyArray<EpicChild>): RepoPool {
	return {
		candidates: children,
		context: { children, resolve: epic_classify.resolve_by_state, read_blockers: no_blockers },
	}
}

function request(repo: string): LaneRequest {
	return epic_lane_offer.lane_request({ repo, is_all_lanes: true }, TWO_LANES, REPO)
}

function holders(numbers: ReadonlyArray<number>): string {
	return JSON.stringify(
		numbers.map((number) => issue(number, CREATED_EARLIER, [IN_PROGRESS_LABEL])),
	)
}

function numbers_of(children: ReadonlyArray<EpicChild>): Array<number> {
	return children.map((entry) => entry.number)
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(lane_await, 'is_process_running_default').mockReturnValue(true)
	vi.spyOn(epic_label_age, 'read_ages').mockResolvedValue(new Map())
	merge_waiting_mock.mockResolvedValue(ONE_LANE)
})

describe('epic_lane_offer.offer_for_repo — a holder waiting on its merge', () => {
	it('offers the lane of a holder whose ship waits on its merge', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(holders([HOLDER, OTHER_HOLDER])))

		const children = [child(FIRST, REPO), child(SECOND, REPO)]
		const offer = await epic_lane_offer.offer_for_repo([pool(children)], request(REPO))

		expect(numbers_of(offer.children)).toEqual([FIRST])
		expect(merge_waiting_mock).toHaveBeenCalledWith([String(HOLDER), String(OTHER_HOLDER)])
	})

	// The ship records are this checkout's: a `--repo` naming another repository would match its holder
	// numbers against this repository's unrelated ships.
	it('discounts no holder of a repository other than this checkout', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(holders([HOLDER])))

		const children = [child(FIRST, OTHER_REPO), child(SECOND, OTHER_REPO)]
		const offer = await epic_lane_offer.offer_for_repo([pool(children)], request(OTHER_REPO))

		expect(numbers_of(offer.children)).toEqual([FIRST])
		expect(merge_waiting_mock).not.toHaveBeenCalled()
	})
})

describe('epic_lane_offer.lane_request — whether `--repo` is this checkout', () => {
	it('reads a `--repo` that differs only in case as this checkout', () => {
		const request_read = epic_lane_offer.lane_request(
			{ repo: REPO.toUpperCase(), is_all_lanes: false },
			ONE_LANE,
			REPO,
		)

		expect(request_read.is_this_checkout).toBe(true)
	})

	it('reads another repository as not this checkout', () => {
		expect(request(OTHER_REPO).is_this_checkout).toBe(false)
	})
})
