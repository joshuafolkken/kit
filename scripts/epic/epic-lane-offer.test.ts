import { auto_ok_fixture, CREATED_EARLIER } from '#scripts/auto-ok/auto-ok-fixture'
import {
	capped_listing_outcome,
	listing_of,
	listing_outcome,
} from '#scripts/git/git-gh-issue-list-fixture'
import { IN_PROGRESS_LABEL } from '#scripts/git/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfirmContext } from './epic-candidate-confirm'
import { epic_classify } from './epic-classify'
import type { EpicChild, IssueReference } from './epic-graph'
import { epic_lane_offer, type LaneRequest, type RepoPool } from './epic-lane-offer'

// joshuafolkken/kit#1491: how many children a repository has room to start. The occupancy is counted
// from its `in-progress` listing on GitHub, never from anything a session remembers — two sessions
// counting to six in their own memory would give twelve lanes.

vi.mock('#scripts/git/git-gh-command', () => ({
	git_gh_command: { issue_list_by_label_in_repo: vi.fn() },
}))

const { git_gh_command } = await import('#scripts/git/git-gh-command')
const issue_list = vi.mocked(git_gh_command.issue_list_by_label_in_repo)

const { issue } = auto_ok_fixture

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const HOLDER = 700
const OTHER_HOLDER = 701
const FIRST = 861
const SECOND = 862
const THIRD = 863
const ONE_LANE = 1
const TWO_LANES = 2
const THREE_LANES = 3

function child(number: number, repo: string = REPO): EpicChild {
	return { number, repo, state: 'OPEN', labels: [], blocked_by: [] }
}

async function no_blockers(): Promise<Array<IssueReference>> {
	return []
}

function context(children: ReadonlyArray<EpicChild>): ConfirmContext {
	return { children, resolve: epic_classify.resolve_by_state, read_blockers: no_blockers }
}

function pool(children: ReadonlyArray<EpicChild>): RepoPool {
	return { candidates: children, context: context(children) }
}

function request(limit: number, is_all_lanes = true): LaneRequest {
	return { repo: REPO, limit, is_all_lanes }
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
})

describe('epic_lane_offer.offer_for_repo — how many children fit', () => {
	it('offers one child per free lane', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome('[]'))

		const children = [child(FIRST), child(SECOND), child(THIRD)]
		const offer = await epic_lane_offer.offer_for_repo([pool(children)], request(TWO_LANES))

		expect(numbers_of(offer.children)).toEqual([FIRST, SECOND])
	})

	// The occupancy is subtracted from the limit rather than treated as a lock: one child running in a
	// two-lane repository leaves one lane, which is the whole of joshuafolkken/kit#1491.
	it('subtracts what is already running from the limit', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(holders([HOLDER])))

		const children = [child(FIRST), child(SECOND)]
		const offer = await epic_lane_offer.offer_for_repo([pool(children)], request(TWO_LANES))

		expect(numbers_of(offer.children)).toEqual([FIRST])
	})

	it('offers a single child when the caller did not ask for every lane', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome('[]'))

		const children = [child(FIRST), child(SECOND), child(THIRD)]
		const offer = await epic_lane_offer.offer_for_repo(
			[pool(children)],
			request(THREE_LANES, false),
		)

		expect(numbers_of(offer.children)).toEqual([FIRST])
	})
})

describe('epic_lane_offer.offer_for_repo — a repository with no free lane', () => {
	it('offers nothing once the limit is reached', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(holders([HOLDER, OTHER_HOLDER])))

		const offer = await epic_lane_offer.offer_for_repo([pool([child(FIRST)])], request(TWO_LANES))

		expect(offer.children).toEqual([])
		expect(offer.verdict).toBe('wait')
	})

	it('says how many lanes are in use, and what releases one', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(holders([HOLDER])))

		const offer = await epic_lane_offer.offer_for_repo([pool([child(FIRST)])], request(ONE_LANE))

		expect(offer.notice).toContain(`1 of ${String(ONE_LANE)} lanes in use`)
		expect(offer.notice).toContain('No lane is free')
	})

	// A limit lowered under what is already running, or a stale label that outlived its run: the free
	// count is never negative, and a negative slice is not a thing to offer.
	it('offers nothing when more is running than the limit allows', async () => {
		issue_list.mockResolvedValueOnce(
			listing_of([
				issue(HOLDER, CREATED_EARLIER, [IN_PROGRESS_LABEL]),
				issue(OTHER_HOLDER, CREATED_EARLIER, [IN_PROGRESS_LABEL]),
			]),
		)

		const offer = await epic_lane_offer.offer_for_repo([pool([child(FIRST)])], request(ONE_LANE))

		expect(offer.children).toEqual([])
	})
})

// A listing nobody could read, and one that was cut short, both authorize nothing: "I saw no holder"
// is not "there are no holders", and that answer would start work.
describe('epic_lane_offer.offer_for_repo — a listing that settles nothing', () => {
	it('offers nothing when the listing could not be read', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome(undefined))

		const offer = await epic_lane_offer.offer_for_repo([pool([child(FIRST)])], request(THREE_LANES))

		expect(offer.children).toEqual([])
		expect(offer.notice).toContain('not "nothing is running"')
	})

	it('offers nothing when the listing was cut short', async () => {
		issue_list.mockResolvedValueOnce(capped_listing_outcome('[]'))

		const offer = await epic_lane_offer.offer_for_repo([pool([child(FIRST)])], request(THREE_LANES))

		expect(offer.children).toEqual([])
		expect(offer.verdict).toBe('wait')
	})
})

// The pool is a list of candidate sources, and nothing in it names an epic. Multi-epic execution is
// not wired up anywhere yet; what this asserts is that the scheduler would not have to be rewritten
// to add it (joshuafolkken/kit#1491).
describe('epic_lane_offer.offer_for_repo — the pool is not one epic', () => {
	it('fills the free lanes from more than one source', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome('[]'))

		const offer = await epic_lane_offer.offer_for_repo(
			[pool([child(FIRST)]), pool([child(SECOND), child(THIRD)])],
			request(THREE_LANES),
		)

		expect(numbers_of(offer.children)).toEqual([FIRST, SECOND, THIRD])
	})

	it('stops asking further sources once the lanes are spoken for', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome('[]'))

		const offer = await epic_lane_offer.offer_for_repo(
			[pool([child(FIRST)]), pool([child(SECOND)])],
			request(ONE_LANE),
		)

		expect(numbers_of(offer.children)).toEqual([FIRST])
	})

	// The free count was read for the repository the request names, so a candidate living somewhere
	// else would take a lane nobody counted — the double allocation joshuafolkken/kit#925 closed. A
	// caller with children in two repositories asks twice, once per repository.
	it('drops a candidate that lives in another repository', async () => {
		issue_list.mockResolvedValueOnce(listing_outcome('[]'))

		const offer = await epic_lane_offer.offer_for_repo(
			[pool([child(FIRST, OTHER_REPO)]), pool([child(SECOND)])],
			request(THREE_LANES),
		)

		expect(numbers_of(offer.children)).toEqual([SECOND])
	})
})

// Two sources that both offered nothing can disagree about why, and the answer has to say what the
// caller should do. The order is `epic_report.decide_verdict`'s own — waiting before stopping, since
// a run that stops while something is still resolving abandons an epic that was going to finish.
describe('epic_lane_offer.combine_verdicts', () => {
	it('prefers waiting to stopping', () => {
		expect(epic_lane_offer.combine_verdicts('stop', 'wait')).toBe('wait')
		expect(epic_lane_offer.combine_verdicts('wait', 'stop')).toBe('wait')
	})

	it('prefers a source with work to one without', () => {
		expect(epic_lane_offer.combine_verdicts('complete', 'run')).toBe('run')
	})

	it('reports complete only when nothing else was said', () => {
		expect(epic_lane_offer.combine_verdicts('complete', 'complete')).toBe('complete')
	})
})
