import { describe, expect, it } from 'vitest'
import { run_board_estimate, type EstimateRead } from './run-board-estimate'
import type { BoardLayout, BoardRow, QueuedEntry } from './run-board-layout'
import type { Phase } from './run-board-phase'
import type { ItemState } from './run-board-status'
import type { UsualTimes } from './run-board-usual'

// joshuafolkken/kit#4044: how long the run has left — a running child's phase remainder and the phases
// after it, the waves' children stacked onto the lane that frees first, and nothing for a parked or
// unreached child.

const MINUTE = 60_000
const NOW = Date.parse('2026-10-18T09:00:00.000Z')
const EMPTY_LAYOUT: BoardLayout = { active: [], queued: [], people: [], unreached: [] }
// One child usually takes 30 minutes: 20 implementing, 6 in the gate, 4 in the followup.
const USUAL: UsualTimes = new Map<Phase, number>([
	['implement', 20 * MINUTE],
	['gate', 6 * MINUTE],
	['followup', 4 * MINUTE],
])
const PER_CHILD = 30 * MINUTE

function row(number: number, state: ItemState): BoardRow {
	return { number, title: undefined, kind: undefined, state, status: undefined, waits: [] }
}

// A running child that entered `phase` `spent` minutes ago.
function running(number: number, phase: Phase, spent: number): BoardRow {
	const status = { state: 'running' as const, track: [phase], phase_ms: NOW - spent * MINUTE }

	return { ...row(number, 'running'), status }
}

function queue(...rows: ReadonlyArray<BoardRow>): Array<QueuedEntry> {
	return rows.map((entry) => ({ kind: 'row' as const, row: entry }))
}

function read(layout: Partial<BoardLayout>, extra: Partial<EstimateRead> = {}): EstimateRead {
	const board = { ...EMPTY_LAYOUT, ...layout }

	return { now_ms: NOW, ended_ms: undefined, layout: board, usual: USUAL, lane_limit: 2, ...extra }
}

describe('run_board_estimate.left_ms for a running child', () => {
	it('adds what is left of its phase to the phases after it', () => {
		const active = [running(1, 'implement', 5)]

		expect(run_board_estimate.left_ms(read({ active }))).toBe(25 * MINUTE)
	})

	it('counts a phase run past its usual time as done', () => {
		const active = [running(1, 'gate', 10)]

		expect(run_board_estimate.left_ms(read({ active }))).toBe(4 * MINUTE)
	})

	it('counts the gate still ahead of a child in its sync', () => {
		const active = [running(1, 'sync', 0)]

		expect(run_board_estimate.left_ms(read({ active }))).toBe(10 * MINUTE)
	})

	it('counts a failed ship as back at implement', () => {
		const active = [running(1, 'failed', 0)]

		expect(run_board_estimate.left_ms(read({ active }))).toBe(PER_CHILD)
	})

	it('counts a child with no phase read as freshly launched', () => {
		const active = [row(1, 'running')]

		expect(run_board_estimate.left_ms(read({ active }))).toBe(PER_CHILD)
	})
})

describe('run_board_estimate.left_ms for the queue', () => {
	it('stacks each waiting child onto the lane that frees first', () => {
		const active = [running(1, 'gate', 0)]
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

	it('estimates nothing without a usual time', () => {
		const active = [running(1, 'implement', 0)]

		const empty = read({ active }, { usual: new Map() })
		const absent = read({ active }, { usual: undefined })

		expect(run_board_estimate.left_ms(empty)).toBeUndefined()
		expect(run_board_estimate.left_ms(absent)).toBeUndefined()
	})

	it('estimates nothing before a layout is read', () => {
		const unread = read({}, { layout: undefined })

		expect(run_board_estimate.left_ms(unread)).toBeUndefined()
	})
})

describe('run_board_estimate.part_of', () => {
	it('draws the estimate to the minute after 🏁', () => {
		const active = [running(1, 'implement', 5)]

		expect(run_board_estimate.part_of(read({ active }))).toBe('🏁 ~25′')
	})

	it('draws nothing for an ended run', () => {
		const active = [running(1, 'implement', 5)]

		expect(run_board_estimate.part_of(read({ active }, { ended_ms: NOW }))).toBeUndefined()
	})
})
