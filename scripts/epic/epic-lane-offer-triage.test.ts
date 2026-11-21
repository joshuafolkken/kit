import { auto_ok_fixture, CREATED_EARLIER } from '#scripts/auto-ok/auto-ok-fixture'
import { backlog_interrupt } from '#scripts/backlog/backlog-interrupt'
import { listing_outcome } from '#scripts/gh/git-gh-issue-list-fixture'
import {
	BUG_LABEL,
	INTERRUPT_ROUTE_LABEL,
	RUN_LANE_LABEL,
	RUN_SOLO_LABEL,
} from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_classify } from './epic-classify'
import type { EpicChild, IssueReference } from './epic-graph'
import { epic_lane_offer, type LaneRequest, type RepoPool } from './epic-lane-offer'
import { epic_triage } from './epic-triage'

// joshuafolkken/kit#2779: a named epic's lanes go through `epic:next --lanes`, so the triage gate
// `backlog:next` applies holds here as well.

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_list_by_label_in_repo: vi.fn() },
}))

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
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
	return { repo: REPO, limit: TWO_LANES, is_all_lanes, is_this_checkout: true }
}

beforeEach(() => {
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

// joshuafolkken/kit#7860: an interrupt defect outside the pool awaiting a decision holds these lanes
// as it holds `backlog:next`.
const INTERRUPT = 839

function serve_interrupt(): void {
	const row = {
		...auto_ok_fixture.issue(INTERRUPT, CREATED_EARLIER, [
			BUG_LABEL,
			INTERRUPT_ROUTE_LABEL,
			RUN_SOLO_LABEL,
		]),
		body: 'Every run fails the Security Audit in `.github/workflows/`.',
	}

	issue_list.mockImplementation(async (label) =>
		listing_outcome(label === INTERRUPT_ROUTE_LABEL ? JSON.stringify([row]) : '[]'),
	)
}

describe('epic_lane_offer.offer_for_repo — an interrupt awaiting a decision', () => {
	it('offers nothing and names the interrupt as awaiting a decision', async () => {
		serve_interrupt()
		const offer = await epic_lane_offer.offer_for_repo(
			[pool([child(FIRST, [RUN_LANE_LABEL])])],
			request(),
		)

		expect(offer.children).toEqual([])
		expect(offer.verdict).toBe('wait')
		expect(offer.notice).toContain(`issues/${String(INTERRUPT)}`)
		expect(backlog_interrupt.is_decision_wait(offer.notice)).toBe(true)
	})

	it('does not hold the single-child form', async () => {
		serve_interrupt()
		const offer = await epic_lane_offer.offer_for_repo(
			[pool([child(FIRST, [RUN_LANE_LABEL])])],
			request(false),
		)

		expect(offer.children.map((entry) => entry.number)).toEqual([FIRST])
	})
})
