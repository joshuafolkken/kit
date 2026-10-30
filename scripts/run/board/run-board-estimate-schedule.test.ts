import { describe, expect, it } from 'vitest'
import { run_board_estimate, type EstimateRead } from './run-board-estimate'
import type { BoardLayout, BoardRow, QueuedEntry, RowReason } from './run-board-layout'
import type { Phase } from './run-board-phase'
import type { UsualTimes } from './run-board-usual'

// joshuafolkken/kit#4319: a waiting child starts no earlier than what it waits on ends — a running
// `run:solo` child, a 🔗 blocker, the 📂 path holder, the 🧍 / 🙅 solo wait — and one waiting on an
// issue the board does not carry is left out.

const MINUTE = 60_000
const NOW = Date.parse('2026-10-21T09:00:00.000Z')
const EMPTY_LAYOUT: BoardLayout = { active: [], queued: [], people: [], unreached: [] }
// A shared child estimate isolates scheduling from differences in phase duration.
const USUAL: UsualTimes = new Map<Phase, number>([['implement', 30 * MINUTE]])
const PER_CHILD = 30 * MINUTE
// What the running child has left: 30′ usual, 5′ spent.
const RUNNING_LEFT = 25 * MINUTE

function waiting(number: number, waits: Array<string> = [], reason?: RowReason): BoardRow {
	const row: BoardRow = {
		number,
		title: undefined,
		kind: undefined,
		state: 'waiting',
		status: undefined,
		waits,
	}

	return reason === undefined ? row : { ...row, reason }
}

// A child five minutes into its implementation.
function running(number: number, is_solo = false): BoardRow {
	const status = {
		state: 'running' as const,
		track: ['implement' as const],
		phase_ms: NOW - 5 * MINUTE,
	}

	return { ...waiting(number), state: 'running', status, ...(is_solo && { is_solo }) }
}

function queue(...rows: ReadonlyArray<BoardRow>): Array<QueuedEntry> {
	return rows.map((row) => ({ kind: 'row' as const, row }))
}

function left(layout: Partial<BoardLayout>): number | undefined {
	const board = { ...EMPTY_LAYOUT, ...layout }
	const read: EstimateRead = {
		now_ms: NOW,
		ended_ms: undefined,
		layout: board,
		usual: USUAL,
		lane_limit: 2,
	}

	return run_board_estimate.left_ms(read)
}

describe('run_board_estimate.left_ms beside a running run:solo child', () => {
	it('starts no waiting child before the solo child ends', () => {
		const queued = queue(waiting(2), waiting(3), waiting(4))

		// 25′ of the solo child, then three children on two lanes: 30′ + 30′.
		expect(left({ active: [running(1, true)], queued })).toBe(RUNNING_LEFT + 2 * PER_CHILD)
	})

	it('stacks beside an ordinary running child as before', () => {
		const queued = queue(waiting(2), waiting(3), waiting(4))

		expect(left({ active: [running(1)], queued })).toBe(2 * PER_CHILD)
	})
})

describe('run_board_estimate.left_ms for waits a child’s end lifts', () => {
	it('runs a 🔗 chain one after another, however the queue orders it', () => {
		const queued = queue(waiting(5, ['4']), waiting(4, ['3']), waiting(3, ['2']), waiting(2))

		expect(left({ queued })).toBe(4 * PER_CHILD)
	})

	it('starts a 📂 child after the child holding its path', () => {
		const queued = queue(waiting(2, [], { icon: '📂', issues: ['1'], tail: 'a.ts' }))

		expect(left({ active: [running(1)], queued })).toBe(RUNNING_LEFT + PER_CHILD)
	})

	it('fills the free lane with ready children while a 📂 child waits for its holder', () => {
		const held = waiting(2, [], { icon: '📂', issues: ['1'], tail: 'a.ts' })
		const queued = queue(held, waiting(3), waiting(4))

		// 3 and 4 run one after another on the free lane; 2 follows 1 on its own.
		expect(left({ active: [running(1)], queued })).toBe(2 * PER_CHILD)
	})

	it('starts a 🧍 solo child after the running lanes and a 🙅 child after it', () => {
		const solo = waiting(2, [], { icon: '🧍', issues: ['1'] })
		const behind = waiting(3, [], { icon: '🙅', issues: ['2'] })

		expect(left({ active: [running(1)], queued: queue(solo, behind) })).toBe(
			RUNNING_LEFT + 2 * PER_CHILD,
		)
	})

	it('starts nothing beside a placed 🧍 solo child', () => {
		const solo = waiting(2, [], { icon: '🧍', issues: ['1'] })
		const chained = waiting(3, ['1'])

		// 1 ends at 25′, 2 runs alone to 55′, then 3 — not beside 2 on the other lane.
		expect(left({ active: [running(1)], queued: queue(solo, chained) })).toBe(
			RUNNING_LEFT + 2 * PER_CHILD,
		)
	})

	it('leaves out a child waiting on an issue the board does not carry', () => {
		const queued = queue(waiting(2, ['99']), waiting(3, ['owner/repo#1']))

		expect(left({ active: [running(1)], queued })).toBe(RUNNING_LEFT)
	})
})
