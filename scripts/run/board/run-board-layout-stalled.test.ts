import type { EpicChild } from '#scripts/epic/epic-graph'
import { NEEDS_DECISION_LABEL, RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { run_board_layout, type BoardPlan } from './run-board-layout'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#4215: a stalled row's right end names the action that resumes it — after its
// cause where the park event recorded one.

const REPO = 'joshuafolkken/kit'
const STALLED = 33
const NO_STATUSES: ReadonlyMap<number, ItemStatus> = new Map()
const RESUME = { tail: 'fullrun #33' }

function stalled_child(): EpicChild {
	return { number: STALLED, repo: REPO, state: 'OPEN', labels: [RUN_STALLED_LABEL], blocked_by: [] }
}

function plan_of(
	unreached: Array<EpicChild>,
	labels = new Map<number, ReadonlyArray<string>>(),
): BoardPlan {
	const numbers = unreached.map((item) => item.number)

	return {
		waves: { waves: [], unreached },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers: new Set(numbers) },
		labels,
	}
}

describe('run_board_layout.layout_of — a stalled row’s resume action', () => {
	it('draws the resume action on a stalled plan row', () => {
		const layout = run_board_layout.layout_of(plan_of([stalled_child()]), NO_STATUSES)

		expect(layout.unreached.map((row) => row.reason)).toStrictEqual([RESUME])
	})

	it('draws it on a touched stopped row its labels say stalled, which no event explains', () => {
		const labels = new Map([[STALLED, [RUN_STALLED_LABEL]]])
		const statuses = new Map<number, ItemStatus>([[STALLED, { state: 'stopped', started_ms: 1 }]])
		const [row] = run_board_layout.layout_of(plan_of([], labels), statuses).active

		expect(row?.reason).toStrictEqual(RESUME)
	})

	it('draws it on a stalled parked row whose last park event gave no reason', () => {
		const labels = new Map([[STALLED, [RUN_STALLED_LABEL]]])
		const statuses = new Map<number, ItemStatus>([[STALLED, { state: 'parked', started_ms: 1 }]])
		const [row] = run_board_layout.layout_of(plan_of([], labels), statuses).active

		expect(row?.reason).toStrictEqual(RESUME)
	})

	it('draws a parked row’s recorded cause before the resume action', () => {
		const reason = 'review failed → fullrun #33'
		const statuses = new Map<number, ItemStatus>([
			[STALLED, { state: 'parked', started_ms: 1, reason }],
		])
		const [row] = run_board_layout.layout_of(plan_of([]), statuses).active

		expect(row?.reason).toStrictEqual({ tail: reason })
	})

	it('draws no reason on a stopped row that is not stalled, nor on a decision park', () => {
		const reason = `${NEEDS_DECISION_LABEL}: pick one`
		const statuses = new Map<number, ItemStatus>([
			[1, { state: 'stopped', started_ms: 1 }],
			[2, { state: 'parked', started_ms: 2, reason }],
		])
		const layout = run_board_layout.layout_of(plan_of([]), statuses)

		expect(layout.active.map((row) => row.reason)).toStrictEqual([undefined, undefined])
	})
})
