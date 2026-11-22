import { describe, expect, it } from 'vitest'
import { run_board_estimate, type EstimateRead } from './run-board-estimate'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout, BoardRow, QueuedEntry } from './run-board-layout'
import type { Phase } from './run-board-phase'
import type { ItemState } from './run-board-status'
import type { UsualTimes } from './run-board-usual'

// joshuafolkken/kit#7770: when the run should finish — a running child's remainder from the lane totals
// longer than its time so far, the phases' usual times past every total, the waves' children at the
// median total stacked onto the lane that frees first, and nothing for a parked or unreached child.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const NOW = Date.parse('2026-10-18T09:00:00.000Z')
const EMPTY_LAYOUT: BoardLayout = { active: [], queued: [], people: [], unreached: [] }
// Distinct phase estimates expose whether the remaining phases are summed correctly.
const USUAL: UsualTimes = new Map<Phase, number>([
	['implement', 20 * MINUTE],
	['gate', 6 * MINUTE],
	['followup', 4 * MINUTE],
])
const TOTALS = [20 * MINUTE, 30 * MINUTE, 40 * MINUTE]
const PER_CHILD = 30 * MINUTE

function row(number: number, state: ItemState): BoardRow {
	return { number, title: undefined, kind: undefined, state, status: undefined, waits: [] }
}

// A running child launched `elapsed` minutes ago that entered `phase` `spent` minutes ago.
function running(number: number, phase: Phase, spent: number, elapsed = spent): BoardRow {
	const status = {
		state: 'running' as const,
		track: [phase],
		phase_ms: NOW - spent * MINUTE,
		started_ms: NOW - elapsed * MINUTE,
	}

	return { ...row(number, 'running'), status }
}

function queue(...rows: ReadonlyArray<BoardRow>): Array<QueuedEntry> {
	return rows.map((entry) => ({ kind: 'row' as const, row: entry }))
}

function read(layout: Partial<BoardLayout>, extra: Partial<EstimateRead> = {}): EstimateRead {
	const board = { ...EMPTY_LAYOUT, ...layout }

	return {
		now_ms: NOW,
		ended_ms: undefined,
		layout: board,
		usual: USUAL,
		lane_totals: TOTALS,
		lane_limit: 2,
		...extra,
	}
}

describe('run_board_estimate.left_ms for a running child', () => {
	it('takes the median of what the longer lanes took beyond its time so far', () => {
		const active = [running(1, 'implement', 5)]

		// 15′, 25′ and 35′ beyond 5′.
		expect(run_board_estimate.left_ms(read({ active }))).toBe(25 * MINUTE)
	})

	it('reads only the lanes that ran longer than it', () => {
		const active = [running(1, 'gate', 0, 25)]

		// 5′ and 15′ beyond 25′; the 20′ lane ended sooner.
		expect(run_board_estimate.left_ms(read({ active }))).toBe(10 * MINUTE)
	})

	it('times a relaunched child from its latest launch', () => {
		const relaunched = running(1, 'implement', 5, 60)
		const status = {
			...relaunched.status,
			state: 'running' as const,
			launched_ms: NOW - 5 * MINUTE,
		}

		expect(run_board_estimate.left_ms(read({ active: [{ ...relaunched, status }] }))).toBe(
			25 * MINUTE,
		)
	})

	it('counts a failed ship as freshly launched', () => {
		const active = [running(1, 'failed', 0)]

		expect(run_board_estimate.left_ms(read({ active }))).toBe(PER_CHILD)
	})

	it('counts a child with no status read as freshly launched', () => {
		const active = [row(1, 'running')]

		expect(run_board_estimate.left_ms(read({ active }))).toBe(PER_CHILD)
	})
})

describe('run_board_estimate.left_ms for a child longer than every lane', () => {
	it('falls back to the usual phases', () => {
		const active = [running(1, 'gate', 10, 50)]

		// The gate's 6′ is spent; the followup's 4′ is left rather than nothing.
		expect(run_board_estimate.left_ms(read({ active }))).toBe(4 * MINUTE)
	})

	it('counts the gate still ahead of a child in its sync', () => {
		const active = [running(1, 'sync', 0, 50)]

		expect(run_board_estimate.left_ms(read({ active }))).toBe(10 * MINUTE)
	})

	it('counts a failed ship as back at implement', () => {
		const active = [running(1, 'failed', 0, 50)]

		// 20′ + 6′ + 4′ from implement on.
		expect(run_board_estimate.left_ms(read({ active }))).toBe(30 * MINUTE)
	})
})

// joshuafolkken/kit#7905: time the host stopped is no time spent at the phase.
describe('run_board_estimate.phase_spent', () => {
	const GAPS = [{ from_ms: NOW - 4 * MINUTE, to_ms: NOW - MINUTE }]

	function slept(phase: Phase, spent: number): BoardRow {
		const base = running(1, phase, spent, 50)

		return { ...base, status: { ...base.status, state: 'running', gaps: GAPS } }
	}

	it('leaves the host stops inside the phase out of the time spent there', () => {
		const awake = run_board_estimate.phase_spent(running(1, 'gate', 5).status, NOW)
		const asleep = run_board_estimate.phase_spent(slept('gate', 5).status, NOW)

		expect(awake).toBe(5 * MINUTE)
		expect(asleep).toBe(2 * MINUTE)
	})

	it('is undefined where no event said when the child got to its phase', () => {
		expect(run_board_estimate.phase_spent(undefined, NOW)).toBeUndefined()
	})

	it('leaves the stopped time on the phase’s usual time in the fallback', () => {
		const asleep = read({ active: [slept('gate', 5)] })
		const awake = read({ active: [running(1, 'gate', 5, 50)] })

		// 6′ − 2′ net of the gate, then the followup’s 4′.
		expect(run_board_estimate.left_ms(asleep)).toBe(8 * MINUTE)
		expect(run_board_estimate.left_ms(awake)).toBe(5 * MINUTE)
	})
})

describe('run_board_estimate.left_ms for the queue', () => {
	it('stacks each waiting child onto the lane that frees first', () => {
		const active = [running(1, 'gate', 0, 25)]
		const queued = queue(row(2, 'waiting'), row(3, 'waiting'))

		// Lane 1 frees at 10′ and lane 2 is free: 2 → lane 2 (30′), 3 → lane 1 (10′ + 30′).
		expect(run_board_estimate.left_ms(read({ active, queued }))).toBe(40 * MINUTE)
	})

	it('runs as many lanes as are running where no lane limit is read', () => {
		const queued = queue(row(2, 'waiting'), row(3, 'waiting'))

		expect(run_board_estimate.left_ms(read({ queued }, { lane_limit: undefined }))).toBe(
			2 * PER_CHILD,
		)
	})

	it('counts an epic’s waiting children and leaves a decision out', () => {
		const epic: QueuedEntry = {
			kind: 'epic',
			epic: 9,
			title: undefined,
			rows: [row(2, 'waiting'), row(3, 'human')],
		}

		expect(run_board_estimate.left_ms(read({ queued: [epic] }))).toBe(PER_CHILD)
	})
})

describe('run_board_estimate.left_ms with nothing to estimate', () => {
	it('leaves a parked and an unreached child out', () => {
		const layout = { active: [row(1, 'parked')], unreached: [row(2, 'waiting')] }

		expect(run_board_estimate.left_ms(read(layout))).toBeUndefined()
	})

	it('estimates nothing without a lane total', () => {
		const active = [running(1, 'implement', 0)]

		const empty = read({ active }, { lane_totals: [] })
		const absent = read({ active }, { lane_totals: undefined })

		expect(run_board_estimate.left_ms(empty)).toBeUndefined()
		expect(run_board_estimate.left_ms(absent)).toBeUndefined()
	})

	it('estimates nothing before a layout is read', () => {
		const unread = read({}, { layout: undefined })

		expect(run_board_estimate.left_ms(unread)).toBeUndefined()
	})
})

describe('run_board_estimate.queued_finish_ms with nothing to estimate', () => {
	it('leaves an unreached, a human and an unqueued child out', () => {
		const queued = queue(row(2, 'waiting'), row(3, 'human'))
		const board = read({ queued, unreached: [row(4, 'waiting')] })

		expect(run_board_estimate.queued_finish_ms(board, 2)).toBe(NOW + PER_CHILD)
		expect(
			[3, 4, 5].map((number) => run_board_estimate.queued_finish_ms(board, number)),
		).toStrictEqual([undefined, undefined, undefined])
	})

	it('finishes no queued child without a lane total', () => {
		const board = read({ queued: queue(row(2, 'waiting')) }, { lane_totals: [] })

		expect(run_board_estimate.queued_finish_ms(board, 2)).toBeUndefined()
	})
})

describe('run_board_estimate.row_finish', () => {
	it('finishes a running child when the header reads it as finishing', () => {
		const child = running(1, 'implement', 5)

		expect(run_board_estimate.row_finish(child, read({}))?.finish_ms).toBe(NOW + 25 * MINUTE)
	})

	it('draws no drift for a child just launched', () => {
		expect(run_board_estimate.row_finish(running(1, 'implement', 0), read({}))?.drift_ms).toBe(0)
	})

	it('draws a later finish for a child running past the median total', () => {
		// Done in 10′, 5′ past the 30′ median from its launch 25′ ago.
		const child = running(1, 'gate', 0, 25)

		expect(run_board_estimate.row_finish(child, read({}))?.drift_ms).toBe(5 * MINUTE)
	})

	it('estimates nothing without a measured lane total', () => {
		const finish = run_board_estimate.row_finish(
			running(1, 'implement', 5),
			read({}, { lane_totals: [] }),
		)

		expect(finish).toBeUndefined()
	})
})

describe('run_board_estimate.is_finish_drawn', () => {
	const MOVING = { ended_ms: undefined, activity: { is_stopped: false } }

	it.each(['running', 'parked'] as const)('draws a finish on a %s row', (state) => {
		expect(run_board_estimate.is_finish_drawn(row(1, state), MOVING)).toBe(true)
	})

	it.each(['done', 'human'] as const)('draws none on a %s row', (state) => {
		expect(run_board_estimate.is_finish_drawn(row(1, state), MOVING)).toBe(false)
	})

	it('draws none on an earlier run’s lane', () => {
		const earlier = { ...running(1, 'implement', 5), is_earlier: true }

		expect(run_board_estimate.is_finish_drawn(earlier, MOVING)).toBe(false)
	})

	it.each([
		['an ended', { ended_ms: NOW, activity: { is_stopped: false } }],
		['a stopped', { ended_ms: undefined, activity: { is_stopped: true } }],
	])('draws none while %s run', (_name, run) => {
		expect(run_board_estimate.is_finish_drawn(running(1, 'implement', 5), run)).toBe(false)
	})
})

// joshuafolkken/kit#8478: no `~` — the 🎯 says the time is an estimate.
describe('run_board_estimate.stamp_of', () => {
	it('draws the local finish time after 🎯 on the same day', () => {
		const finish = NOW + 25 * MINUTE

		expect(run_board_estimate.stamp_of(NOW, finish)).toBe(
			`🎯 ${run_board_labels.minute_of(finish)}`,
		)
	})

	it('draws the day too for a finish on another day', () => {
		const finish = NOW + 30 * HOUR

		expect(run_board_estimate.stamp_of(NOW, finish)).toBe(
			`🎯 ${run_board_labels.day_minute_of(finish)}`,
		)
	})
})
