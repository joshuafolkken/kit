import { describe, expect, it, vi } from 'vitest'
import { backlog_arrival } from './backlog-arrival'
import type { ReadyPorts } from './backlog-ready'

// joshuafolkken/kit#2503: #2493 was opted in with `auto-ok` while children were in flight and started
// 10.5 minutes later, picked up by the stall detector. The probe wakes the parent within a minute.

const START_MS = 1_000_000
const MINUTE_MS = backlog_arrival.PROBE_INTERVAL_MS
const FREE = 3
const NO_FREE = 0

interface Pool {
	issues: Array<string>
	free: number
}

function ports_of(pool: Pool): ReadyPorts {
	return {
		free_lane_count: vi.fn(async () => pool.free),
		ready_issues: vi.fn(async () => [...pool.issues]),
	}
}

async function parent(): Promise<boolean> {
	return true
}

async function not_parent(): Promise<boolean> {
	return false
}

describe('backlog_arrival.start — a newly runnable issue wakes the parent', () => {
	it('reports an arrival at the first probe, one minute after the start', async () => {
		const pool = { issues: ['2445'], free: FREE }
		const probe = await backlog_arrival.start(START_MS, ports_of(pool), parent)

		pool.issues.push('2493')

		await expect(probe.has_arrived(START_MS + MINUTE_MS)).resolves.toBe(true)
	})

	it('does not read the backlog again before a minute has passed', async () => {
		const pool = { issues: [], free: FREE }
		const ports = ports_of(pool)
		const probe = await backlog_arrival.start(START_MS, ports, parent)

		await expect(probe.has_arrived(START_MS + MINUTE_MS - 1)).resolves.toBe(false)
		expect(ports.ready_issues).toHaveBeenCalledTimes(1)
	})

	it('does not wake when the runnable pool is unchanged', async () => {
		const probe = await backlog_arrival.start(
			START_MS,
			ports_of({ issues: ['2445'], free: FREE }),
			parent,
		)

		await expect(probe.has_arrived(START_MS + MINUTE_MS)).resolves.toBe(false)
	})

	it('does not wake, nor read the backlog, when no lane is free', async () => {
		const pool: Pool = { issues: [], free: NO_FREE }
		const ports = ports_of(pool)
		const probe = await backlog_arrival.start(START_MS, ports, parent)

		pool.issues.push('2493')

		await expect(probe.has_arrived(START_MS + MINUTE_MS)).resolves.toBe(false)
		expect(ports.ready_issues).toHaveBeenCalledTimes(1)
	})
})

describe('backlog_arrival.start — what never wakes the parent', () => {
	it('does not count an issue that was runnable at the start, even once a lane frees', async () => {
		const pool = { issues: ['2445'], free: NO_FREE }
		const probe = await backlog_arrival.start(START_MS, ports_of(pool), parent)

		pool.free = FREE

		await expect(probe.has_arrived(START_MS + MINUTE_MS)).resolves.toBe(false)
	})

	it('is inert outside a backlogrun parent, reading nothing', async () => {
		const ports = ports_of({ issues: ['2493'], free: FREE })
		const probe = await backlog_arrival.start(START_MS, ports, not_parent)

		await expect(probe.has_arrived(START_MS + MINUTE_MS)).resolves.toBe(false)
		expect(ports.free_lane_count).not.toHaveBeenCalled()
		expect(ports.ready_issues).not.toHaveBeenCalled()
	})

	it('stays inert when the baseline cannot be read, rather than reading it as empty', async () => {
		const ports = ports_of({ issues: ['2445'], free: FREE })

		vi.mocked(ports.ready_issues).mockRejectedValueOnce(new Error('offline'))

		const probe = await backlog_arrival.start(START_MS, ports, parent)

		await expect(probe.has_arrived(START_MS + MINUTE_MS)).resolves.toBe(false)
	})

	it('reads a failed probe as no arrival', async () => {
		const ports = ports_of({ issues: [], free: FREE })
		const probe = await backlog_arrival.start(START_MS, ports, parent)

		vi.mocked(ports.free_lane_count).mockRejectedValueOnce(new Error('git worktree list failed'))

		await expect(probe.has_arrived(START_MS + MINUTE_MS)).resolves.toBe(false)
	})
})

// Round 2 of the review: `backlog:next` exits 0 on `retry` and `error`, and a baseline read as empty
// from either would wake the parent for the whole pool a minute later.
describe('backlog_arrival.answered_issues', () => {
	it('names the runnable issues of an answered read', () => {
		expect(backlog_arrival.answered_issues({ code: 0, out: '2445\n2446' })).toEqual([
			'2445',
			'2446',
		])
	})

	it('reads a --only run as an empty pool', () => {
		expect(backlog_arrival.answered_issues(undefined)).toEqual([])
	})

	it.each([
		{ code: 0, out: 'retry' },
		{ code: 0, out: 'error' },
		{ code: 1, out: '' },
	])('throws on a read that did not answer: $out (exit $code)', (result) => {
		expect(() => backlog_arrival.answered_issues(result)).toThrow('backlog:next')
	})
})

describe('backlog_arrival.arrivals', () => {
	it('names only the issues absent from the baseline', () => {
		const reading = { issues: ['2445', '2493'], free_lanes: FREE }

		expect(backlog_arrival.arrivals(new Set(['2445']), reading)).toEqual(['2493'])
	})

	it('names none without a free lane', () => {
		expect(backlog_arrival.arrivals(new Set(), { issues: ['2493'], free_lanes: NO_FREE })).toEqual(
			[],
		)
	})
})
