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
const RESUME = { tail: '→ resume: fullrun #33' }
const RETRY = { tail: '→ resume: pnpm josh run:add 33 --retry' }
const REVIEW_FAILED = 'run:stalled: review failed'

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

	it('draws a parked row’s cause with the current resume action', () => {
		const reason = REVIEW_FAILED
		const statuses = new Map<number, ItemStatus>([
			[STALLED, { state: 'parked', started_ms: 1, reason }],
		])
		const [row] = run_board_layout.layout_of(plan_of([]), statuses).active

		expect(row?.reason).toStrictEqual({ tail: '→ resume: fullrun #33 (review failed)' })
	})
})

describe('run_board_layout stop and decision reasons', () => {
	it('passes the shared comment question to a park without its own question', () => {
		const plan = { ...plan_of([]), decision_questions: new Map([[1, 'Choose the account']]) }
		const parked = new Map<number, ItemStatus>([
			[1, { state: 'parked', reason: NEEDS_DECISION_LABEL }],
		])
		const [park] = run_board_layout.layout_of(plan, parked).active

		expect(park?.reason?.tail).toBe('→ decide: Choose the account')
	})

	it('keeps a non-stalled stop bare and names a decision park question', () => {
		const reason = `${NEEDS_DECISION_LABEL}: pick one`
		const statuses = new Map<number, ItemStatus>([
			[1, { state: 'stopped', started_ms: 1 }],
			[2, { state: 'parked', started_ms: 2, reason }],
		])
		const layout = run_board_layout.layout_of(plan_of([]), statuses)

		expect(layout.active.map((row) => row.reason)).toStrictEqual([
			undefined,
			{ tail: '→ decide: pick one' },
		])
	})
})

// joshuafolkken/kit#8525: a child that parked itself through `run:park` leaves a bare `#N parked`
// event; its `needs-decision` label alone makes it a 🙋 row with the park comment's next action.
describe('run_board_layout — a bare park on a decision label', () => {
	const PARKED = 8478
	const OUTCOME = 'pnpm josh lane:launch 8478 parent: file A/B/C splits first'
	const bare = new Map<number, ItemStatus>([[PARKED, { state: 'parked', started_ms: 1 }]])

	it('draws it as a 🙋 row whose tail keeps the park outcome (ac-4aaa35aa, ac-f666ee01)', () => {
		const labels = new Map([[PARKED, ['enhancement', NEEDS_DECISION_LABEL]]])
		const pause_reasons = new Map([[PARKED, { summary: OUTCOME, url: undefined, at_ms: 2 }]])
		const layout = run_board_layout.layout_of({ ...plan_of([], labels), pause_reasons }, bare)
		const [row] = layout.active

		expect(row?.state).toBe('human')
		expect(row?.reason?.tail).toContain(OUTCOME)
		expect(run_board_layout.people_of(layout).map((item) => item.number)).toStrictEqual([PARKED])
		expect(run_board_layout.listed_parks(layout).has(PARKED)).toBe(false)
	})

	it('keeps a bare park without a human-stop label a 💤 row (ac-19f5f4a1)', () => {
		const labels = new Map([[PARKED, [RUN_STALLED_LABEL]]])
		const [row] = run_board_layout.layout_of(plan_of([], labels), bare).active

		expect(row?.state).toBe('parked')
	})
})

describe('run_board_layout live backlog retry', () => {
	it('draws live retry on plan and unexplained touched rows (ac-26bb1f1e)', () => {
		const labels = new Map([[STALLED, [RUN_STALLED_LABEL]]])
		const plan = { ...plan_of([stalled_child()], labels), is_backlog_live: true }
		const statuses = new Map<number, ItemStatus>([[STALLED, { state: 'parked' }]])

		expect(run_board_layout.layout_of(plan, NO_STATUSES).unreached[0]?.reason).toStrictEqual(RETRY)
		expect(run_board_layout.layout_of(plan, statuses).active[0]?.reason).toStrictEqual(RETRY)
	})

	it('changes a recorded park’s action without changing its cached status', () => {
		const statuses = new Map<number, ItemStatus>([
			[STALLED, { state: 'parked', reason: REVIEW_FAILED }],
		])
		const plan = plan_of([])
		const live = run_board_layout.layout_of({ ...plan, is_backlog_live: true }, statuses)
		const ended = run_board_layout.layout_of(plan, statuses)

		expect(live.active[0]?.reason?.tail).toBe(`${RETRY.tail} (review failed)`)
		expect(ended.active[0]?.reason?.tail).toBe(`${RESUME.tail} (review failed)`)
	})

	it('uses the live state before the plan has loaded', () => {
		const statuses = new Map<number, ItemStatus>([
			[STALLED, { state: 'parked', reason: 'run:stalled' }],
		])
		const read = { titles: new Map(), labels: new Map(), is_backlog_live: true }

		expect(
			run_board_layout.local_layout_of(statuses, undefined, read).active[0]?.reason,
		).toStrictEqual(RETRY)
	})
})
