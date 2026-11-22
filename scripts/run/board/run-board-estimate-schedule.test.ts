import { describe, expect, it } from 'vitest'
import { run_board_estimate, type EstimateRead } from './run-board-estimate'
import type { BoardLayout, BoardRow, QueuedEntry, RowReason } from './run-board-layout'

// joshuafolkken/kit#4319: a waiting child starts no earlier than what it waits on ends — a running
// `run:solo` child, a 🔗 blocker, the 📂 path holder, the 🧍 / 🙅 solo wait — and one waiting on an
// issue the board does not carry is left out.

const MINUTE = 60_000
const NOW = Date.parse('2026-10-21T09:00:00.000Z')
const EMPTY_LAYOUT: BoardLayout = { active: [], queued: [], people: [], unreached: [] }
// One lane total isolates scheduling from the spread of the totals (joshuafolkken/kit#7770).
const PER_CHILD = 30 * MINUTE
const TOTALS = [PER_CHILD]
// What the running child has left: the 30′ total, 5′ run.
const RUNNING_LEFT = 25 * MINUTE

function waiting(number: number, waits: Array<string> = []): BoardRow {
	return { number, title: undefined, kind: undefined, state: 'waiting', status: undefined, waits }
}

// A waiting child held back for `reason`, with no 🔗 waits.
function held_on(number: number, reason: RowReason): BoardRow {
	return { ...waiting(number), reason }
}

// A child five minutes into its implementation.
function running(number: number, is_solo = false): BoardRow {
	const status = {
		state: 'running' as const,
		track: ['implement' as const],
		phase_ms: NOW - 5 * MINUTE,
		started_ms: NOW - 5 * MINUTE,
	}

	return { ...waiting(number), state: 'running', status, ...(is_solo && { is_solo }) }
}

function queue(...rows: ReadonlyArray<BoardRow>): Array<QueuedEntry> {
	return rows.map((row) => ({ kind: 'row' as const, row }))
}

function read_of(layout: Partial<BoardLayout>): EstimateRead {
	const board = { ...EMPTY_LAYOUT, ...layout }

	return { now_ms: NOW, ended_ms: undefined, layout: board, lane_totals: TOTALS, lane_limit: 2 }
}

function left(layout: Partial<BoardLayout>): number | undefined {
	return run_board_estimate.left_ms(read_of(layout))
}

// When each issue finishes, from now.
function finishes(layout: Partial<BoardLayout>, numbers: ReadonlyArray<number>): Array<unknown> {
	const read = read_of(layout)

	return numbers.map((number) => {
		const finish_ms = run_board_estimate.queued_finish_ms(read, number)

		return finish_ms === undefined ? undefined : finish_ms - NOW
	})
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
		const queued = queue(held_on(2, { icon: '📂', issues: ['1'], tail: 'a.ts' }))

		expect(left({ active: [running(1)], queued })).toBe(RUNNING_LEFT + PER_CHILD)
	})

	it('fills the free lane with ready children while a 📂 child waits for its holder', () => {
		const held = held_on(2, { icon: '📂', issues: ['1'], tail: 'a.ts' })
		const queued = queue(held, waiting(3), waiting(4))

		// 3 and 4 run one after another on the free lane; 2 follows 1 on its own.
		expect(left({ active: [running(1)], queued })).toBe(2 * PER_CHILD)
	})

	it('starts a 🧍 solo child after the running lanes and a 🙅 child after it', () => {
		const solo = held_on(2, { icon: '🧍', issues: ['1'] })
		const behind = held_on(3, { icon: '🙅', issues: ['2'] })

		expect(left({ active: [running(1)], queued: queue(solo, behind) })).toBe(
			RUNNING_LEFT + 2 * PER_CHILD,
		)
	})

	it('starts nothing beside a placed 🧍 solo child', () => {
		const solo = held_on(2, { icon: '🧍', issues: ['1'] })
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

describe('run_board_estimate.queued_finish_ms', () => {
	it('stacks the queue in its order, each later child finishing no sooner', () => {
		const layout = { queued: queue(waiting(2), waiting(3), waiting(4), waiting(5)) }

		// Two lanes: 2 and 3 end at 30′, 4 and 5 at 60′.
		expect(finishes(layout, [2, 3, 4, 5])).toStrictEqual([
			PER_CHILD,
			PER_CHILD,
			2 * PER_CHILD,
			2 * PER_CHILD,
		])
	})

	it('finishes the last queued child when the run finishes', () => {
		const layout = { active: [running(1)], queued: queue(waiting(2), waiting(3), waiting(4)) }

		expect(finishes(layout, [4])).toStrictEqual([left(layout)])
	})

	it('follows a 🔗 chain the queue orders backwards', () => {
		const layout = { queued: queue(waiting(4, ['3']), waiting(3, ['2']), waiting(2)) }

		expect(finishes(layout, [2, 3, 4])).toStrictEqual([PER_CHILD, 2 * PER_CHILD, 3 * PER_CHILD])
	})

	it('leaves out a child waiting on an issue the board does not carry, and a running one', () => {
		const layout = { active: [running(1)], queued: queue(waiting(2, ['99'])) }

		expect(finishes(layout, [1, 2])).toStrictEqual([undefined, undefined])
	})
})
