import type { EpicChild } from '#scripts/epic/epic-graph'
import { backlog_fixture } from './backlog-fixture'
import type { PlanContext } from './backlog-plan'

const BLOCKED_CHILD = 902

function plan_context(open_numbers: ReadonlyArray<number>): PlanContext {
	return { repo: backlog_fixture.REPO, titles: new Map(), open_numbers: new Set(open_numbers) }
}

function epic_child(blockers: ReadonlyArray<number>, labels: ReadonlyArray<string>): EpicChild {
	return {
		number: BLOCKED_CHILD,
		repo: backlog_fixture.REPO,
		state: 'OPEN',
		labels: [...labels],
		blocked_by: blockers.map((number) => ({ repo: backlog_fixture.REPO, number })),
	}
}

const backlog_plan_waiting_fixture = { epic_child, plan_context }

export { backlog_plan_waiting_fixture }
