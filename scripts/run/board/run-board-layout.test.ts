import type { EpicChild } from '#scripts/epic/epic-graph'
import { NEEDS_DECISION_LABEL, RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import {
	run_board_layout,
	type BoardLayout,
	type BoardPlan,
	type QueuedEntry,
	type RowReason,
} from './run-board-layout'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#3430: the board draws the plan's own order, an epic's children as a tree under it,
// and every other dependency as a waiting-on note.

const REPO = 'joshuafolkken/kit'
const BREAKING = 'breaking-change'
const NO_STATUSES: ReadonlyMap<number, ItemStatus> = new Map()
const OPEN_BLOCKER = 3409

function child(
	number: number,
	blocked_by: Array<number> = [],
	labels: Array<string> = [],
): EpicChild {
	const edges = blocked_by.map((blocker) => ({ repo: REPO, number: blocker }))

	return { number, repo: REPO, state: 'OPEN', labels, blocked_by: edges }
}

function plan_of(
	waves: Array<Array<EpicChild>>,
	unreached: Array<EpicChild> = [],
	tracked = new Map<number, number>(),
): BoardPlan {
	const numbers = [...waves.flat(), ...unreached].map((item) => item.number)

	return {
		waves: { waves, unreached },
		tracked,
		context: { repo: REPO, titles: new Map(), open_numbers: new Set([...numbers, OPEN_BLOCKER]) },
		labels: new Map(),
	}
}

function numbers_of(entry: QueuedEntry): Array<number> {
	return entry.kind === 'row' ? [entry.row.number] : entry.rows.map((row) => row.number)
}

function queued_numbers(layout: BoardLayout): Array<number> {
	return layout.queued.flatMap((entry) => numbers_of(entry))
}

describe('run_board_layout.layout_of', () => {
	it('queues the rows in the order the plan gives, and follows the plan when it changes', () => {
		const first = run_board_layout.layout_of(
			plan_of([[child(1), child(2)], [child(3)]]),
			NO_STATUSES,
		)
		const second = run_board_layout.layout_of(
			plan_of([[child(3)], [child(2), child(1)]]),
			NO_STATUSES,
		)

		expect(queued_numbers(first)).toStrictEqual([1, 2, 3])
		expect(queued_numbers(second)).toStrictEqual([3, 2, 1])
	})

	it('gathers an epic’s children under the epic where the first of them falls', () => {
		const tracked = new Map([
			[11, 10],
			[12, 10],
		])
		const layout = run_board_layout.layout_of(
			plan_of([[child(11), child(5), child(12)]], [], tracked),
			NO_STATUSES,
		)

		expect(layout.queued.map((entry) => entry.kind)).toStrictEqual(['epic', 'row'])
		expect(layout.queued[0]).toMatchObject({ kind: 'epic', epic: 10 })
		expect(queued_numbers(layout)).toStrictEqual([11, 12, 5])
	})
})

// joshuafolkken/kit#4137: the board draws one queue, so an epic split over two waves is one group.
describe('run_board_layout.layout_of across waves', () => {
	it('gathers an epic’s children from every wave under one epic in the queue', () => {
		const tracked = new Map([
			[11, 10],
			[12, 10],
		])
		const plan = plan_of(
			[
				[child(11), child(5)],
				[child(6), child(12)],
			],
			[],
			tracked,
		)
		const layout = run_board_layout.layout_of(plan, NO_STATUSES)

		expect(layout.queued.map((entry) => entry.kind)).toStrictEqual(['epic', 'row', 'row'])
		expect(queued_numbers(layout)).toStrictEqual([11, 12, 5, 6])
	})
})

// joshuafolkken/kit#3444: an epic row carries its title, and a queued row waiting on a decision is marked.
describe('run_board_layout.layout_of queued rows', () => {
	it('gives an epic the title the open listing holds for it', () => {
		const plan = plan_of([[child(11)]], [], new Map([[11, 10]]))
		const titled = { ...plan, context: { ...plan.context, titles: new Map([[10, 'Epic ten']]) } }
		const layout = run_board_layout.layout_of(titled, NO_STATUSES)

		expect(layout.queued[0]).toMatchObject({ kind: 'epic', epic: 10, title: 'Epic ten' })
	})

	it('draws a needs-decision queued row as waiting on a person', () => {
		const plan = plan_of([[child(1), child(2, [], [NEEDS_DECISION_LABEL])]])
		const layout = run_board_layout.layout_of(plan, NO_STATUSES)
		const states = layout.queued.map((entry) => (entry.kind === 'row' ? entry.row.state : ''))

		expect(states).toStrictEqual(['waiting', 'human'])
	})
})

// joshuafolkken/kit#3577: every row carries the release category its labels place it in.
describe('run_board_layout.layout_of release kinds', () => {
	it('gives a plan row the kind its own labels place it in, and none without one', () => {
		const plan = plan_of([[child(1, [], ['bug']), child(2)]])
		const layout = run_board_layout.layout_of(plan, NO_STATUSES)
		const kinds = layout.queued.map((entry) => (entry.kind === 'row' ? entry.row.kind : ''))

		expect(kinds).toStrictEqual(['bug', undefined])
	})

	it('gives an active row the kind the read labels place it in', () => {
		const statuses = new Map<number, ItemStatus>([
			[1, { state: 'merged', started_ms: 100 }],
			[2, { state: 'running', started_ms: 200 }],
		])
		const plan = { ...plan_of([]), labels: new Map([[1, [BREAKING]]]) }
		const layout = run_board_layout.layout_of(plan, statuses)

		expect(layout.active.map((row) => [row.number, row.kind])).toStrictEqual([
			[2, undefined],
			[1, BREAKING],
		])
		expect(run_board_layout.local_layout_of(statuses).active[0]?.kind).toBeUndefined()
	})
})

function issues_of(_child: EpicChild, waits: ReadonlyArray<string>): RowReason {
	return { issues: waits }
}

// joshuafolkken/kit#3750: a waiting row carries why it waits; a row the run has touched never does.
describe('run_board_layout.layout_of waiting reasons', () => {
	const REASON: RowReason = { tail: 'untriaged' }

	function reason_of(): RowReason {
		return REASON
	}

	// joshuafolkken/kit#4288: the reader leads a blocked row with its blockers, so it is handed them.
	it('hands the reader the blockers still standing for the row', () => {
		const plan = plan_of([[child(1, [OPEN_BLOCKER])]])
		const layout = run_board_layout.layout_of(plan, NO_STATUSES, issues_of)

		expect(run_board_layout.rows_of(layout)[0]?.reason).toStrictEqual({
			issues: [String(OPEN_BLOCKER)],
		})
	})

	it('gives every waiting row what the reader says of it, in the waves and outside them', () => {
		const plan = plan_of([[child(1)]], [child(2)])
		const layout = run_board_layout.layout_of(plan, NO_STATUSES, reason_of)

		expect(run_board_layout.rows_of(layout).map((row) => row.reason)).toStrictEqual([
			REASON,
			REASON,
		])
	})

	it('asks nothing of a row waiting on a person, or of one the run has touched', () => {
		const statuses = new Map<number, ItemStatus>([[1, { state: 'running', started_ms: 100 }]])
		const plan = plan_of([[child(1), child(2, [], [NEEDS_DECISION_LABEL])]])
		const layout = run_board_layout.layout_of(plan, statuses, reason_of)

		expect(run_board_layout.rows_of(layout).filter((row) => 'reason' in row)).toStrictEqual([])
	})

	it('leaves the key off a row the reader says nothing of, and off every row read without one', () => {
		const plan = plan_of([[child(1)]])
		const silent = run_board_layout.layout_of(plan, NO_STATUSES, () => undefined)
		const unread = run_board_layout.layout_of(plan, NO_STATUSES)

		expect(run_board_layout.rows_of(silent)[0]).not.toHaveProperty('reason')
		expect(run_board_layout.rows_of(unread)[0]).not.toHaveProperty('reason')
	})
})

// joshuafolkken/kit#4045: a parked or withdrawn row says why it ended where ⏳ says why it waits.
describe('run_board_layout.layout_of ending reasons', () => {
	const CAP = 'ship-stop cap'
	const statuses = new Map<number, ItemStatus>([
		[1, { state: 'parked', started_ms: 100, reason: CAP }],
		[2, { state: 'withdrawn', started_ms: 200, ended_ms: 300, reason: 'superseded' }],
		[3, { state: 'withdrawn', started_ms: 250, ended_ms: 400 }],
		[4, { state: 'parked', started_ms: 150 }],
	])
	const layout = run_board_layout.layout_of(plan_of([]), statuses)

	it('draws the ending reason on a parked or withdrawn row, and none where it gave none', () => {
		const reasons = layout.active.map((row) => [row.number, row.reason])

		expect(reasons).toStrictEqual([
			[1, { tail: CAP }],
			[4, undefined],
			[3, undefined],
			[2, { tail: 'superseded' }],
		])
	})

	// joshuafolkken/kit#4127: the findings section says the park of a parked row drawing no reason.
	it('answers the parked rows that draw no reason', () => {
		expect([...run_board_layout.listed_parks(layout)]).toStrictEqual([4])
	})
})

// joshuafolkken/kit#4099: a child parked on a decision waits on a person, its section saying why.
describe('run_board_layout.layout_of decision parks', () => {
	const reason = `${NEEDS_DECISION_LABEL}: pick one`
	const statuses = new Map<number, ItemStatus>([[1, { state: 'parked', started_ms: 100, reason }]])
	const [row] = run_board_layout.layout_of(plan_of([]), statuses).active

	it('draws a decision park as a human row with no reason', () => {
		expect(row?.state).toBe('human')
		expect(row?.reason).toBeUndefined()
		expect(row?.status?.state).toBe('parked')
	})
})

describe('run_board_layout.waiting_children', () => {
	it('answers the children the run has not touched and no person is asked about', () => {
		const statuses = new Map<number, ItemStatus>([[1, { state: 'merged' }]])
		const plan = plan_of([[child(1), child(2)]], [child(3, [], [NEEDS_DECISION_LABEL]), child(4)])
		const waiting = run_board_layout.waiting_children({ plan, statuses })

		expect(waiting.map((item) => item.number)).toStrictEqual([2, 4])
	})
})

describe('run_board_layout.layout_of outside the queue', () => {
	it('drops a blocker from the waiting note once the stream has seen it merge', () => {
		const plan = plan_of([], [child(20, [3409, 3415])])
		const merged = new Map<number, ItemStatus>([[3409, { state: 'merged' }]])

		expect(run_board_layout.layout_of(plan, NO_STATUSES).unreached[0]?.waits).toStrictEqual([
			'3409',
		])
		expect(run_board_layout.layout_of(plan, merged).unreached[0]?.waits).toStrictEqual([])
	})

	it('moves a needs-decision child to the people section', () => {
		const decision = child(30, [], [NEEDS_DECISION_LABEL])
		const layout = run_board_layout.layout_of(plan_of([], [decision, child(31)]), NO_STATUSES)

		expect(layout.people.map((row) => [row.number, row.state])).toStrictEqual([[30, 'human']])
		expect(layout.unreached.map((row) => row.number)).toStrictEqual([31])
	})

	it('lists a touched child only in the active section, a running one before a finished one', () => {
		const statuses = new Map<number, ItemStatus>([
			[2, { state: 'running', started_ms: 200 }],
			[1, { state: 'merged', started_ms: 100, ended_ms: 150 }],
		])
		const layout = run_board_layout.layout_of(plan_of([[child(1), child(2)], [child(3)]]), statuses)

		expect(layout.active.map((row) => row.number)).toStrictEqual([2, 1])
		expect(queued_numbers(layout)).toStrictEqual([3])
		expect(run_board_layout.is_settled('merged')).toBe(true)
		expect(run_board_layout.is_settled('running')).toBe(false)
	})
})

// joshuafolkken/kit#4104: the ⏳ rows keep the plan's order ahead of the 📅 rows, which follow from the
// earliest start — two on the same day by the time.
const STARTS: ReadonlyMap<number, number> = new Map([
	[41, Date.parse('2999-03-01T09:00Z')],
	[43, Date.parse('2999-01-02T15:00Z')],
	[44, Date.parse('2999-01-02T08:00Z')],
])

function start_reason(item: EpicChild): RowReason {
	const not_before_ms = STARTS.get(item.number)

	return { tail: 'waits', ...(not_before_ms !== undefined && { not_before_ms }) }
}

describe('run_board_layout.layout_of unreached order', () => {
	it('draws the waiting rows first, then the rows waiting on a start time from the earliest', () => {
		const unreached = [41, 42, 43, 44, 45].map((number) => child(number))
		const layout = run_board_layout.layout_of(plan_of([], unreached), NO_STATUSES, start_reason)

		expect(layout.unreached.map((row) => row.number)).toStrictEqual([42, 45, 44, 43, 41])
	})
})

// joshuafolkken/kit#4222: a running issue sits in no wave, yet its lane is still the run's own.
describe('run_board_layout.numbers_of', () => {
	it('holds the running issues beside the waves and the unreached ones', () => {
		const plan = plan_of([[child(2)]], [child(3)])
		const running = { ...plan, waves: { ...plan.waves, running: [child(1)] } }

		expect([...run_board_layout.numbers_of(running)]).toStrictEqual([2, 3, 1])
	})
})

// joshuafolkken/kit#4042: the running rows first, then the parked and stopped ones, each in the order
// it started; then the finished ones from the newest end, one with no recorded end last.
describe('run_board_layout.layout_of active order', () => {
	it('orders the running, then the parked and stopped, then the finished rows', () => {
		const statuses = new Map<number, ItemStatus>([
			[1, { state: 'merged', started_ms: 100, ended_ms: 500 }],
			[2, { state: 'parked', started_ms: 300 }],
			[3, { state: 'running', started_ms: 400 }],
			[4, { state: 'withdrawn', started_ms: 150, ended_ms: 900 }],
			[5, { state: 'stopped', started_ms: 200 }],
			[6, { state: 'running', started_ms: 250 }],
			[7, { state: 'done', started_ms: 50 }],
			[8, { state: 'done', started_ms: 60, ended_ms: 700 }],
		])
		const layout = run_board_layout.layout_of(plan_of([]), statuses)

		expect(layout.active.map((row) => row.number)).toStrictEqual([6, 3, 5, 2, 4, 8, 1, 7])
	})

	it('names merged, done and withdrawn as finished, and parked, stopped and running not', () => {
		const finished = (['merged', 'done', 'withdrawn', 'parked', 'stopped', 'running'] as const).map(
			(state) => run_board_layout.is_finished(state),
		)

		expect(finished).toStrictEqual([true, true, true, false, false, false])
	})
})

// joshuafolkken/kit#4102: a mechanical park asks nobody for a decision, so it stays out of 🙋.
describe('run_board_layout.layout_of — a run:stalled child', () => {
	it('draws it as stopped in the unreached section, never with the people', () => {
		const plan = plan_of([], [child(33, [], [RUN_STALLED_LABEL])])
		const layout = run_board_layout.layout_of(plan, NO_STATUSES)

		expect(layout.people).toStrictEqual([])
		expect(layout.unreached.map((row) => [row.number, row.state])).toStrictEqual([[33, 'stopped']])
	})

	it('leaves it out of the waiting children', () => {
		const plan = plan_of([[child(1), child(2, [], [RUN_STALLED_LABEL])]])
		const waiting = run_board_layout.waiting_children({ plan, statuses: NO_STATUSES })

		expect(waiting.map((item) => item.number)).toStrictEqual([1])
	})
})
