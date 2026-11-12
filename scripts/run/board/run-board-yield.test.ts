import type { EpicChild } from '#scripts/epic/epic-graph'
import type { LaneStateRecord } from '#scripts/lane/lane-state'
import { lane_yield } from '#scripts/lane/lane-yield'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_header } from './run-board-header'
import { run_board_lane_state } from './run-board-lane-state'
import {
	run_board_layout,
	type BoardLayout,
	type BoardPlan,
	type RowReason,
} from './run-board-layout'
import { run_board_status } from './run-board-status'

// joshuafolkken/kit#6886: a child that gave its lane back still waits in the run, so the board draws
// it queued on the lane holding its file — not as a withdrawal in the done section.

const KIND = run_event_stream.EVENT_KIND
const REPO = 'joshuafolkken/kit'
const YIELDED = 6861
const FIRST_HOLDER = 6503
const NEXT_HOLDER = 6871
const PATH = 'scripts/backlog/backlog-drive.ts'
const T0 = '2026-11-09T10:37:00.000Z'
const T1 = '2026-11-09T10:38:00.000Z'
const T2 = '2026-11-09T11:40:00.000Z'
const { NO_LANES } = run_board_lane_state

function event_at(pos: number, at: string, kind: string, text: string): RunEvent {
	return { pos, at, kind, text }
}

function launch(pos: number, at: string): RunEvent {
	return event_at(pos, at, KIND.CHILD_LAUNCH, `#${String(YIELDED)} launched`)
}

function withdrawal(by: string): RunEvent {
	return event_at(2, T1, KIND.WITHDRAW, `#${String(YIELDED)} withdrawn by ${by}: overlaps`)
}

const YIELD_CLOSE = withdrawal(lane_yield.YIELD_TEXT.name)
const PERSON_CLOSE = withdrawal('a person')
const RUNNING_RECORD: LaneStateRecord = {
	issue: String(YIELDED),
	run: { started_at: T0 },
	state: 'running',
	launched_at: T0,
	changed_at: T0,
	changed_by: 'lane:dispatch',
}

function child(number: number): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [], blocked_by: [] }
}

const PLAN: BoardPlan = {
	waves: { waves: [[child(YIELDED)]], unreached: [] },
	tracked: new Map(),
	context: { repo: REPO, titles: new Map(), open_numbers: new Set([YIELDED]) },
	labels: new Map(),
}

function overlap_on(holder: number): () => RowReason {
	return () => ({ icon: '📂', issues: [String(holder)], tail: PATH })
}

function layout_after(events: ReadonlyArray<RunEvent>, holder = FIRST_HOLDER): BoardLayout {
	const statuses = run_board_status.statuses_of(events, NO_LANES)

	return run_board_layout.layout_of(PLAN, statuses, overlap_on(holder))
}

function queued_reasons(layout: BoardLayout): Array<RowReason | undefined> {
	return run_board_layout.queued_rows(layout).map((row) => row.reason)
}

describe('run_board_status a yielded child', () => {
	it('drops the status of a child whose lane closed on its yield', () => {
		const statuses = run_board_status.statuses_of([launch(1, T0), YIELD_CLOSE], NO_LANES)

		expect(statuses.has(YIELDED)).toBe(false)
	})

	it('queues a yielded child on the holder of its file, and draws no done row for it', () => {
		const layout = layout_after([launch(1, T0), YIELD_CLOSE])

		expect(layout.active).toStrictEqual([])
		expect(queued_reasons(layout)).toStrictEqual([
			{ icon: '📂', issues: [String(FIRST_HOLDER)], tail: PATH },
		])
	})

	it('names the lane that holds the file now once the holder changes', () => {
		const layout = layout_after([launch(1, T0), YIELD_CLOSE], NEXT_HOLDER)

		expect(queued_reasons(layout).map((reason) => reason?.issues)).toStrictEqual([
			[String(NEXT_HOLDER)],
		])
	})
})

describe('run_board_status a yielded child beside other endings', () => {
	it('still draws a person’s withdrawal as a withdrawn done row', () => {
		const layout = layout_after([launch(1, T0), PERSON_CLOSE])

		expect(layout.active.map((row) => row.state)).toStrictEqual(['withdrawn'])
		expect(run_board_layout.queued_rows(layout)).toStrictEqual([])
	})

	it('draws a yielded child launched again on its lane row alone', () => {
		const layout = layout_after([launch(1, T0), YIELD_CLOSE, launch(3, T2)])

		expect(layout.active.map((row) => row.state)).toStrictEqual(['running'])
		expect(layout.active[0]?.status?.started_ms).toBe(Date.parse(T2))
		expect(run_board_layout.queued_rows(layout)).toStrictEqual([])
	})

	it('queues a yielded child whose lane record still says running', () => {
		const events = [launch(1, T0), YIELD_CLOSE]
		const lanes = run_board_lane_state.lanes_of({
			events,
			lanes: [String(YIELDED)],
			records: new Map([[String(YIELDED), RUNNING_RECORD]]),
			started_ms: Date.parse(T0),
		})
		const statuses = run_board_status.statuses_of(events, lanes)

		expect(lanes.own.has(YIELDED)).toBe(false)
		expect(statuses.has(YIELDED)).toBe(false)
	})

	it('counts a yielded child as remaining, not settled', () => {
		const counts = run_board_header.counts_of(layout_after([launch(1, T0), YIELD_CLOSE]))

		expect(counts).toMatchObject({ total: 1, settled: 0, running: 0, remaining: 1 })
	})
})
