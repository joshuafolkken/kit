import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_SOLO_LABEL } from '#scripts/git/issue-labels'
import { describe, expect, it } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_plan, type PlanContext } from './backlog-plan'

// The `run:solo` mark on a plan row (joshuafolkken/kit#2776). Kept apart from `backlog-plan.test.ts`,
// which is at its line limit.

const CHILD = 901
const TITLE = 'Verify the closing link before merge'

const CONTEXT: PlanContext = {
	repo: backlog_fixture.REPO,
	titles: new Map([[CHILD, TITLE]]),
	open_numbers: new Set(),
}

function child(labels: ReadonlyArray<string>): EpicChild {
	return { number: CHILD, repo: backlog_fixture.REPO, state: 'OPEN', labels, blocked_by: [] }
}

describe('backlog_plan.row_of', () => {
	it('marks a run:solo child beside its number', () => {
		expect(backlog_plan.row_of(child([RUN_SOLO_LABEL]), CONTEXT, '')).toContain(
			`#${String(CHILD)} ${backlog_plan.SOLO_MARK}  ${TITLE}`,
		)
	})

	it('leaves a child without the label unmarked', () => {
		expect(backlog_plan.row_of(child([]), CONTEXT, '')).not.toContain(backlog_plan.SOLO_MARK)
	})
})
