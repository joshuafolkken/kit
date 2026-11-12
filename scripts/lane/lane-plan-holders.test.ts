import path from 'node:path'
import { backlog_fixture } from '#scripts/backlog/backlog-fixture'
import { backlog_overlap } from '#scripts/backlog/backlog-overlap'
import type { BusyRead } from '#scripts/epic/epic-busy'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { session_cite } from '#scripts/issue/session-cite'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_plan } from './lane-plan'

const make_directory = temporary_directory('suite')

// joshuafolkken/kit#7185: a running lane outside the opted-in listing had no entry in what dispatch
// declares, so a candidate on a file it planned ran beside it and met it again at the merge of main.

const { REPO } = backlog_fixture
const ROOT = make_directory('lane-plan-holders-')
const DIRECTORY = path.join(ROOT, 'lane')
const HOLDER = 7121
const CANDIDATE = 7185
const LISTED = 7184
const PLANNED = 'scripts/backlog/backlog-overlap.ts'
const CITED = 'scripts/backlog/backlog-rank.ts'
const HOLDER_PLAN = { issue: HOLDER, paths: [PLANNED], planned_at: '2026-11-11T03:00:00.000Z' }

beforeEach(() => {
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(
		make_directory(path.join(ROOT, 'repository-')),
	)
})

function candidate(): EpicChild {
	return { number: CANDIDATE, repo: REPO, state: 'OPEN', labels: [RUN_LANE_LABEL], blocked_by: [] }
}

const RUNNING: BusyRead = {
	kind: 'busy',
	issues: [
		{ number: HOLDER, title: 'running', createdAt: '2026-11-11T00:00:00Z', blockedBy: undefined },
	],
}

// The offer for the candidate, its body naming `PLANNED`, beside the running holder no listing read.
function offer(): ReturnType<typeof backlog_overlap.separate> {
	const listed = backlog_overlap.declared_of([{ number: CANDIDATE, body: `- \`${PLANNED}\`` }])
	const declared = lane_plan.with_holder_plans(listed, [HOLDER], DIRECTORY)

	return backlog_overlap.separate({ offered: [candidate()], withheld: [] }, declared, {
		read: RUNNING,
		repo: REPO,
	})
}

describe('lane_plan.with_holder_plans', () => {
	it('adds the recorded plan of a holder the declaration has no entry for', () => {
		lane_plan.record(HOLDER_PLAN, DIRECTORY)

		const declared = lane_plan.with_holder_plans(new Map(), [HOLDER], DIRECTORY)

		expect([...(declared.get(HOLDER) ?? [])]).toEqual([PLANNED])
	})

	it('adds nothing for a holder with no recorded plan', () => {
		expect(lane_plan.with_holder_plans(new Map(), [HOLDER], DIRECTORY).has(HOLDER)).toBe(false)
	})

	it('keeps the entry a listed holder already declares', () => {
		lane_plan.record({ ...HOLDER_PLAN, issue: LISTED }, DIRECTORY)

		const listed = new Map([[LISTED, new Set([CITED])]])
		const declared = lane_plan.with_holder_plans(listed, [LISTED], DIRECTORY)

		expect([...(declared.get(LISTED) ?? [])]).toEqual([CITED])
	})
})

describe('backlog_overlap.separate on an unlisted running lane', () => {
	it('withholds a candidate on a file the running lane planned', () => {
		lane_plan.record(HOLDER_PLAN, DIRECTORY)

		const separated = offer()

		expect(separated.offered).toEqual([])
		expect(separated.withheld.map((child) => child.number)).toEqual([CANDIDATE])
	})

	it('names the planned file and the holding lane in the wait note', () => {
		lane_plan.record(HOLDER_PLAN, DIRECTORY)

		const holder = session_cite.issue(HOLDER, undefined, REPO)

		expect(offer().notice).toContain(`\`${PLANNED}\`, which ${holder} declares`)
	})

	it('offers the candidate as before while the running lane recorded no plan', () => {
		const separated = offer()

		expect(separated.offered.map((child) => child.number)).toEqual([CANDIDATE])
		expect(separated.notice).toBeUndefined()
	})
})
