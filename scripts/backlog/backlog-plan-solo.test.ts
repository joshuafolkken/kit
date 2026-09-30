import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL, RUN_SOLO_LABEL } from '#scripts/git/issue-labels'
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

	it('leaves a run:lane child unmarked', () => {
		const row = backlog_plan.row_of(child([RUN_LANE_LABEL]), CONTEXT, '')

		expect(row).not.toContain(backlog_plan.SOLO_MARK)
		expect(row).not.toContain(backlog_plan.UNTRIAGED_MARK)
	})

	// joshuafolkken/kit#2779: a child with neither label is the one `backlog:next` answers `triage` for.
	it('marks a child with neither label as untriaged', () => {
		expect(backlog_plan.row_of(child([]), CONTEXT, '')).toContain(
			`#${String(CHILD)} ${backlog_plan.UNTRIAGED_MARK}  ${TITLE}`,
		)
	})

	it('reads the labels case-insensitively', () => {
		expect(backlog_plan.row_of(child(['Run:Lane']), CONTEXT, '')).not.toContain(
			backlog_plan.UNTRIAGED_MARK,
		)
	})
})
