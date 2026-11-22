import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { run_board_layout, type BoardPlan } from './run-board-layout'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#8578: a child withdrawn after it parked on a decision is drawn once, as a 🙋 row,
// while its open issue still carries the label; without the label it ends as before.

const REPO = 'joshuafolkken/kit'
const ISSUE = 8353
const WITHDRAWN: ReadonlyMap<number, ItemStatus> = new Map([
	[ISSUE, { state: 'withdrawn', started_ms: 1, reason: `#${String(ISSUE)} withdrawn` }],
])

function plan_of(labels: Array<string>): BoardPlan {
	return {
		waves: { waves: [], unreached: [] },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers: new Set([ISSUE]) },
		labels: new Map([[ISSUE, labels]]),
	}
}

function states_of(labels: Array<string>): Array<string> {
	const layout = run_board_layout.layout_of(plan_of(labels), WITHDRAWN)

	return layout.active.filter((row) => row.number === ISSUE).map((row) => row.state)
}

describe('run_board_layout.layout_of on a withdrawn child', () => {
	it('draws an open withdrawn child carrying needs-decision as one 🙋 row', () => {
		expect(states_of([NEEDS_DECISION_LABEL])).toStrictEqual(['human'])
	})

	it('draws a withdrawn child without the label as one ending row', () => {
		expect(states_of([])).toStrictEqual(['withdrawn'])
	})
})
