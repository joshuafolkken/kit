import type { EpicChild } from '#scripts/epic/epic-graph'
import { NEEDS_DECISION_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { run_board_layout, type BoardPlan, type DecisionBlocker } from './run-board-layout'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#8026: the 🙋 section draws each blocker a person acts on once, naming the children
// it holds, and the header and the now line count the same rows.

const REPO = 'joshuafolkken/kit'
const NO_STATUSES: ReadonlyMap<number, ItemStatus> = new Map()
const HELD = 8101
const OUTSIDE = 8102
const PARKED = 8103
const ASKED = 8104
const TITLE = 'Blocker title'
const HOLDS_NOTE = '(blocks #8101)'

function child(
	number: number,
	labels: Array<string> = [],
	blocked_by: Array<number> = [],
): EpicChild {
	const edges = blocked_by.map((edge) => ({ repo: REPO, number: edge }))

	return { number, repo: REPO, state: 'OPEN', labels, blocked_by: edges }
}

function blocker(number: number, blocks: ReadonlyArray<number>): DecisionBlocker {
	return { number, title: TITLE, labels: [RUN_LANE_LABEL], need: 'take', blocks }
}

function plan_of(unreached: Array<EpicChild>, blockers: Array<DecisionBlocker>): BoardPlan {
	const open = unreached.map((item) => item.number)

	return {
		waves: { waves: [], unreached },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers: new Set([...open, OUTSIDE]) },
		labels: new Map(),
		decision_blockers: blockers,
	}
}

const OUTSIDE_PLAN = plan_of([child(HELD, [], [OUTSIDE])], [blocker(OUTSIDE, [HELD])])

function numbers(rows: ReadonlyArray<{ number: number }>): Array<number> {
	return rows.map((row) => row.number)
}

describe('run_board_layout.layout_of blocker rows (joshuafolkken/kit#8026)', () => {
	it('draws an outside blocker as a person row the header counts', () => {
		const layout = run_board_layout.layout_of(OUTSIDE_PLAN, NO_STATUSES)

		expect(numbers(layout.blockers ?? [])).toStrictEqual([OUTSIDE])
		expect(numbers(run_board_layout.people_of(layout))).toContain(OUTSIDE)
		expect(numbers(run_board_layout.drawn_rows(layout))).toContain(OUTSIDE)
	})

	it('draws no blocker row for an outside blocker an earlier run lane works', () => {
		const earlier = { lanes: [String(OUTSIDE)] }
		const layout = run_board_layout.layout_of(OUTSIDE_PLAN, NO_STATUSES, undefined, earlier)

		expect(layout.blockers).toStrictEqual([])
		expect(numbers(run_board_layout.people_of(layout))).not.toContain(OUTSIDE)
		expect(numbers(layout.earlier ?? [])).toStrictEqual([OUTSIDE])
	})

	it('names the children a parked person row holds', () => {
		const plan = plan_of([child(PARKED, [NEEDS_DECISION_LABEL])], [blocker(PARKED, [HELD])])
		const layout = run_board_layout.layout_of(plan, NO_STATUSES)

		expect(layout.people.map((row) => row.reason?.tail)).toStrictEqual([
			expect.stringContaining(HOLDS_NOTE),
		])
	})

	it('names the children an asked active row holds', () => {
		const statuses: ReadonlyMap<number, ItemStatus> = new Map([[ASKED, { state: 'human' }]])
		const plan = plan_of([], [blocker(ASKED, [HELD])])
		const layout = run_board_layout.layout_of(plan, statuses)

		expect(layout.active.map((row) => row.reason?.tail)).toStrictEqual([
			expect.stringContaining(HOLDS_NOTE),
		])
		expect(layout.blockers).toStrictEqual([])
	})
})
