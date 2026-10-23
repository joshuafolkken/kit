import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_report } from '#scripts/epic/epic-report'
import { NEEDS_DECISION_LABEL, RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_plan, type PlanContext } from './backlog-plan'

// joshuafolkken/kit#4102: every park label puts a child under the person heading, so each row names
// its own — a `run:stalled` child read as `needs-decision` sends a person to decide a failure. Kept
// apart from `backlog-plan.test.ts`, which is at its line limit.

const DECISION_CHILD = 901
const STALLED_CHILD = 902

const CONTEXT: PlanContext = {
	repo: backlog_fixture.REPO,
	titles: new Map(),
	open_numbers: new Set(),
}

function child(number: number, label: string): EpicChild {
	return { number, repo: backlog_fixture.REPO, state: 'OPEN', labels: [label], blocked_by: [] }
}

function person_section(): string {
	const result = epic_report.build_result(
		{
			runnable: [],
			time: [],
			human: [child(DECISION_CHILD, NEEDS_DECISION_LABEL), child(STALLED_CHILD, RUN_STALLED_LABEL)],
		},
		[],
	)
	const text = backlog_plan.format_plan(result, [], CONTEXT, { issues: [], only: false })

	return text.split(backlog_plan.HUMAN_HEADING)[1]?.split(backlog_plan.SCOPE_HEADING)[0] ?? ''
}

describe('what a parked child is waiting on a person for', () => {
	it('names needs-decision on the child that waits for a decision', () => {
		expect(person_section()).toContain(
			`${backlog_fixture.cite(DECISION_CHILD)} ${backlog_plan.UNTRIAGED_MARK}  — \`${NEEDS_DECISION_LABEL}\``,
		)
	})

	it('names run:stalled on the mechanically stalled child', () => {
		expect(person_section()).toContain(
			`${backlog_fixture.cite(STALLED_CHILD)} ${backlog_plan.UNTRIAGED_MARK}  — \`${RUN_STALLED_LABEL}\``,
		)
	})

	it('keeps needs-decision out of the heading the stalled rows sit under', () => {
		expect(backlog_plan.HUMAN_HEADING).not.toContain(NEEDS_DECISION_LABEL)
	})
})
