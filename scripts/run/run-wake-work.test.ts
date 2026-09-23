import { describe, expect, it } from 'vitest'
import type { CarryRead, RunCarry } from './run-carry'
import { run_wake_work, type WorkPorts } from './run-wake-work'

// joshuafolkken/kit#2417. Whether a woken session would find work, read cheap-first: the record, then
// the local lane count, then the one network read — and a read that cannot answer is not "no work".

const BUDGET_ONLY = 'backlogrun --max 5 --idle 30'
const FREE_LANES = 2
const READY = 3

function carried(invocation: string, done?: Array<number>): CarryRead {
	const carry: RunCarry = {
		invocation,
		started_at: '2026-09-10T08:00:00.000Z',
		merged: 0,
		filed: 0,
		cuts: 1,
		failures: 0,
		outages: 0,
		is_handed_off: true,
		...(done && { done }),
	}

	return { kind: 'carried', carry }
}

interface Probe {
	ports: WorkPorts
	calls: Array<string>
}

function probe(free: number | undefined, ready: number | undefined): Probe {
	const calls: Array<string> = []

	return {
		calls,
		ports: {
			free_lane_count: async () => {
				calls.push('lanes')

				return free
			},
			ready_count: async () => {
				calls.push('backlog')

				return ready
			},
		},
	}
}

describe('run_wake_work.has_work — what the record answers without a read', () => {
	it('has work while named issues remain, and reads nothing to say so', async () => {
		const reads = probe(0, 0)

		expect(await run_wake_work.has_work(carried('backlogrun #1 #2', [1]), reads.ports)).toBe(true)
		expect(reads.calls).toStrictEqual([])
	})

	// The session is needed to finish the run, and an `--only` run has no pool to wait on.
	it('has work when an --only run has finished its named list', async () => {
		const reads = probe(0, 0)

		expect(await run_wake_work.has_work(carried('backlogrun #1 --only', [1]), reads.ports)).toBe(
			true,
		)
	})
})

describe('run_wake_work.has_work — the lane and backlog reads', () => {
	it('has no work when every lane is taken, and skips the backlog read', async () => {
		const reads = probe(0, READY)

		expect(await run_wake_work.has_work(carried(BUDGET_ONLY), reads.ports)).toBe(false)
		expect(reads.calls).toStrictEqual(['lanes'])
	})

	it('has work when a lane is free and an issue is ready', async () => {
		expect(await run_wake_work.has_work(carried(BUDGET_ONLY), probe(FREE_LANES, READY).ports)).toBe(
			true,
		)
	})

	it('has no work when a lane is free and nothing is ready', async () => {
		expect(await run_wake_work.has_work(carried(BUDGET_ONLY), probe(FREE_LANES, 0).ports)).toBe(
			false,
		)
	})

	it('has work after the named list is done only if the pool has some', async () => {
		const read = carried('backlogrun #1', [1])

		expect(await run_wake_work.has_work(read, probe(FREE_LANES, 0).ports)).toBe(false)
	})

	// A failed backlog read is not an empty backlog.
	it('cannot tell when the backlog read fails', async () => {
		const reads = probe(FREE_LANES, undefined)

		expect(await run_wake_work.has_work(carried(BUDGET_ONLY), reads.ports)).toBeUndefined()
	})
})

describe('run_wake_work.has_work — a read that cannot answer', () => {
	// An unreadable lane limit is not a full house.
	it('cannot tell when the lane limit is unreadable, and skips the backlog read', async () => {
		const reads = probe(undefined, READY)

		expect(await run_wake_work.has_work(carried(BUDGET_ONLY), reads.ports)).toBeUndefined()
		expect(reads.calls).toStrictEqual(['lanes'])
	})

	// A read that throws must not end the supervisor.
	it('cannot tell when the lane read throws', async () => {
		const ports: WorkPorts = {
			free_lane_count: async () => {
				await Promise.resolve()
				throw new Error('worktree list failed')
			},
			ready_count: async () => {
				await Promise.resolve()

				return READY
			},
		}

		expect(await run_wake_work.has_work(carried(BUDGET_ONLY), ports)).toBeUndefined()
	})
})
