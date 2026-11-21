import type { EpicChild } from '#scripts/epic/epic-graph'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { TRANSPORT_ENV_VAR } from '#scripts/gh/git-gh-transport'
import {
	IN_PROGRESS_LABEL,
	NEEDS_HUMAN_REVIEW_LABEL,
	RUN_LANE_LABEL,
} from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_decision_read } from './run-board-decision-read'
import type { BoardPlan } from './run-board-layout-types'

const REPO = 'joshuafolkken/kit'
const WAITING = 7491
const REVIEW = 5272
const MIDDLE = 5270

function child(number: number, blockers: ReadonlyArray<number> = []): EpicChild {
	return {
		number,
		repo: REPO,
		state: 'OPEN',
		labels: [RUN_LANE_LABEL],
		blocked_by: blockers.map((blocker) => ({ repo: REPO, number: blocker, state: 'OPEN' })),
	}
}

function plan_of(children: Array<EpicChild>): BoardPlan {
	return {
		waves: { waves: [], unreached: children },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers: new Set([WAITING, REVIEW, MIDDLE]) },
		labels: new Map(children.map((node) => [node.number, node.labels])),
		withheld: new Set([WAITING, MIDDLE]),
	}
}

beforeEach(() => {
	vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
	vi.spyOn(git_gh_issue_read, 'issue_list_comments').mockResolvedValue('[]')
})

describe('run_board_decision_read review stops (joshuafolkken/kit#8527)', () => {
	it('stops a waiting row at the review stop holding it, as a person to review (ac-a29fcafa)', async () => {
		const labels = [IN_PROGRESS_LABEL, NEEDS_HUMAN_REVIEW_LABEL]
		const review = { ...child(REVIEW, [MIDDLE]), labels }
		const plan = await run_board_decision_read.with_decisions(
			plan_of([child(WAITING, [REVIEW]), review, child(MIDDLE)]),
		)

		expect(plan?.decision_blockers).toMatchObject([
			{ number: REVIEW, need: 'review', blocks: [WAITING] },
		])
	})
})
