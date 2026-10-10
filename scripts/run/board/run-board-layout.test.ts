import type { EpicChild } from '#scripts/epic/epic-graph'
import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import {
	run_board_layout,
	type BoardLayout,
	type BoardPlan,
	type WaveEntry,
} from './run-board-layout'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#3430: the board draws the plan's own order, an epic's children as a tree under it,
// and every other dependency as a waiting-on note.

const REPO = 'joshuafolkken/kit'
const BREAKING = 'breaking-change'
const NO_STATUSES: ReadonlyMap<number, ItemStatus> = new Map()

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
		context: { repo: REPO, titles: new Map(), open_numbers: new Set([...numbers, 3409]) },
		labels: new Map(),
	}
}

function numbers_of(entry: WaveEntry): Array<number> {
	return entry.kind === 'row' ? [entry.row.number] : entry.rows.map((row) => row.number)
}

function wave_numbers(layout: BoardLayout): Array<Array<number>> {
	return layout.waves.map((wave) => wave.flatMap((entry) => numbers_of(entry)))
}

describe('run_board_layout.layout_of', () => {
	it('draws the waves in the order the plan gives, and follows the plan when it changes', () => {
		const first = run_board_layout.layout_of(
			plan_of([[child(1), child(2)], [child(3)]]),
			NO_STATUSES,
		)
		const second = run_board_layout.layout_of(
			plan_of([[child(3)], [child(2), child(1)]]),
			NO_STATUSES,
		)

		expect(wave_numbers(first)).toStrictEqual([[1, 2], [3]])
		expect(wave_numbers(second)).toStrictEqual([[3], [2, 1]])
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

		expect(layout.waves[0]?.map((entry) => entry.kind)).toStrictEqual(['epic', 'row'])
		expect(layout.waves[0]?.[0]).toMatchObject({ kind: 'epic', epic: 10 })
		expect(wave_numbers(layout)).toStrictEqual([[11, 12, 5]])
	})
})

// joshuafolkken/kit#3444: an epic row carries its title, and a wave row waiting on a decision is marked.
describe('run_board_layout.layout_of wave rows', () => {
	it('gives an epic the title the open listing holds for it', () => {
		const plan = plan_of([[child(11)]], [], new Map([[11, 10]]))
		const titled = { ...plan, context: { ...plan.context, titles: new Map([[10, 'Epic ten']]) } }
		const layout = run_board_layout.layout_of(titled, NO_STATUSES)

		expect(layout.waves[0]?.[0]).toMatchObject({ kind: 'epic', epic: 10, title: 'Epic ten' })
	})

	it('draws a needs-decision wave row as waiting on a person', () => {
		const plan = plan_of([[child(1), child(2, [], [NEEDS_DECISION_LABEL])]])
		const layout = run_board_layout.layout_of(plan, NO_STATUSES)
		const states = layout.waves[0]?.map((entry) => (entry.kind === 'row' ? entry.row.state : ''))

		expect(states).toStrictEqual(['waiting', 'human'])
	})
})

// joshuafolkken/kit#3577: every row carries the release category its labels place it in.
describe('run_board_layout.layout_of release kinds', () => {
	it('gives a plan row the kind its own labels place it in, and none without one', () => {
		const plan = plan_of([[child(1, [], ['bug']), child(2)]])
		const layout = run_board_layout.layout_of(plan, NO_STATUSES)
		const kinds = layout.waves[0]?.map((entry) => (entry.kind === 'row' ? entry.row.kind : ''))

		expect(kinds).toStrictEqual(['bug', undefined])
	})

	it('gives an active row the kind the read labels place it in', () => {
		const statuses = new Map<number, ItemStatus>([
			[1, { state: 'merged', started_ms: 100 }],
			[2, { state: 'running', started_ms: 200 }],
		])
		const plan = { ...plan_of([]), labels: new Map([[1, [BREAKING]]]) }
		const layout = run_board_layout.layout_of(plan, statuses)

		expect(layout.active.map((row) => row.kind)).toStrictEqual([BREAKING, undefined])
		expect(run_board_layout.local_layout_of(statuses).active[0]?.kind).toBeUndefined()
	})
})

describe('run_board_layout.layout_of outside the waves', () => {
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

	it('lists a touched child only in the active section, in the order each started', () => {
		const statuses = new Map<number, ItemStatus>([
			[2, { state: 'running', started_ms: 200 }],
			[1, { state: 'merged', started_ms: 100, ended_ms: 150 }],
		])
		const layout = run_board_layout.layout_of(plan_of([[child(1), child(2)], [child(3)]]), statuses)

		expect(layout.active.map((row) => row.number)).toStrictEqual([1, 2])
		expect(wave_numbers(layout)).toStrictEqual([[3]])
		expect(run_board_layout.is_settled('merged')).toBe(true)
		expect(run_board_layout.is_settled('running')).toBe(false)
	})
})
