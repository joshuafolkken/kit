import { listing_outcome } from '#scripts/git/git-gh-issue-list-fixture'
import { RUN_LANE_LABEL, RUN_SOLO_LABEL } from '#scripts/git/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_classify } from './epic-classify'
import type { EpicChild, IssueReference } from './epic-graph'
import { epic_lane_offer, type LaneRequest, type RepoPool } from './epic-lane-offer'
import { epic_triage } from './epic-triage'

// joshuafolkken/kit#2779: a named epic's lanes go through `epic:next --lanes`, so the triage gate
// `backlog:next` applies holds here as well.

vi.mock('#scripts/git/git-gh-command', () => ({
	git_gh_command: { issue_list_by_label_in_repo: vi.fn() },
}))

const { git_gh_command } = await import('#scripts/git/git-gh-command')
const issue_list = vi.mocked(git_gh_command.issue_list_by_label_in_repo)

const REPO = 'joshuafolkken/kit'
const OTHER_REPO = 'joshuafolkken/app-kit'
const FIRST = 861
const SECOND = 862
const THIRD = 863
const TWO_LANES = 2

function child(number: number, labels: ReadonlyArray<string>, repo: string = REPO): EpicChild {
	return { number, repo, state: 'OPEN', labels, blocked_by: [] }
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

function request(is_all_lanes = true): LaneRequest {
	return { repo: REPO, limit: TWO_LANES, is_all_lanes }
}

beforeEach(() => {
	vi.clearAllMocks()
	issue_list.mockResolvedValue(listing_outcome('[]'))
})

describe('epic_lane_offer.offer_for_repo — triage', () => {
	it('answers triage and offers nothing while a candidate is untriaged', async () => {
		const children = [child(FIRST, [RUN_LANE_LABEL]), child(SECOND, [])]
		const offer = await epic_lane_offer.offer_for_repo([pool(children)], request())

		expect(offer.children).toEqual([])
		expect(offer.verdict).toBe(epic_triage.TRIAGE_VERDICT)
		expect(offer.notice).toContain(`issues/${String(SECOND)}`)
		expect(issue_list).not.toHaveBeenCalled()
	})

	it('reads an untriaged candidate in a later pool too', async () => {
		const pools = [pool([child(FIRST, [RUN_LANE_LABEL])]), pool([child(THIRD, [])])]
		const offer = await epic_lane_offer.offer_for_repo(pools, request())

		expect(offer.verdict).toBe(epic_triage.TRIAGE_VERDICT)
	})

	it('names a child two epics both track once', async () => {
		const pools = [pool([child(SECOND, [])]), pool([child(SECOND, [])])]
		const offer = await epic_lane_offer.offer_for_repo(pools, request())

		expect(offer.notice.split(`issues/${String(SECOND)}`)).toHaveLength(2)
	})
})

describe('epic_lane_offer.offer_for_repo — nothing untriaged', () => {
	it('offers the children once each is judged', async () => {
		const children = [child(FIRST, [RUN_LANE_LABEL]), child(SECOND, ['RUN:LANE'])]
		const offer = await epic_lane_offer.offer_for_repo([pool(children)], request())

		expect(offer.children.map((entry) => entry.number)).toEqual([FIRST, SECOND])
	})

	it('offers a run:solo head alone as before', async () => {
		const children = [child(FIRST, [RUN_SOLO_LABEL]), child(SECOND, [RUN_LANE_LABEL])]
		const offer = await epic_lane_offer.offer_for_repo([pool(children)], request())

		expect(offer.children.map((entry) => entry.number)).toEqual([FIRST])
	})

	it('ignores an untriaged child in another repository', async () => {
		const children = [child(FIRST, [RUN_LANE_LABEL]), child(THIRD, [], OTHER_REPO)]
		const offer = await epic_lane_offer.offer_for_repo([pool(children)], request())

		expect(offer.children.map((entry) => entry.number)).toEqual([FIRST])
	})

	it('does not gate the single-child form', async () => {
		const offer = await epic_lane_offer.offer_for_repo([pool([child(FIRST, [])])], request(false))

		expect(offer.children.map((entry) => entry.number)).toEqual([FIRST])
	})
})
