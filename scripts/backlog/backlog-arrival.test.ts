import { describe, expect, it, vi } from 'vitest'
import { backlog_arrival, type ArrivalPorts } from './backlog-arrival'

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

function ports_of(pool: Pool, added_at: Array<number> = []): ArrivalPorts {
	return {
		free_lane_count: vi.fn(async () => pool.free),
		ready_issues: vi.fn(async () => [...pool.issues]),
		is_added_since: vi.fn(async (since_ms: number) => added_at.some((at) => at >= since_ms)),
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

	it('does not read an unreadable baseline as empty', async () => {
		const ports = ports_of({ issues: ['2445'], free: FREE })

		vi.mocked(ports.ready_issues).mockRejectedValueOnce(new Error('offline'))

		const probe = await backlog_arrival.start(START_MS, ports, parent)

		await expect(probe.has_arrived(START_MS + MINUTE_MS)).resolves.toBe(false)
	})
})

// joshuafolkken/kit#3433: an issue `run:add` handed the run wakes the parent at the next tick, without
// the minute — and a `--only` run, whose pool is always empty, wakes at all.
describe('backlog_arrival.start — an issue run:add handed the run', () => {
	it('wakes the parent before the first pool probe is due', async () => {
		const probe = await backlog_arrival.start(
			START_MS,
			ports_of({ issues: [], free: NO_FREE }, [START_MS + 1]),
			parent,
		)

		await expect(probe.has_arrived(START_MS + 1)).resolves.toBe(true)
	})

	it('does not wake for an addition made before the watcher started', async () => {
		const probe = await backlog_arrival.start(
			START_MS,
			ports_of({ issues: [], free: FREE }, [START_MS - 1]),
			parent,
		)

		await expect(probe.has_arrived(START_MS + 1)).resolves.toBe(false)
	})
})

// joshuafolkken/kit#3102: the report no longer ends `--wait`, so an inert probe would leave the parent
// without a wake until the bound.
describe('backlog_arrival.start — a baseline that did not answer', () => {
	it('retries an unreadable baseline and wakes on an issue that arrives after it answers', async () => {
		const pool = { issues: ['2445'], free: FREE }
		const ports = ports_of(pool)

		vi.mocked(ports.ready_issues).mockRejectedValueOnce(new Error('offline'))

		const probe = await backlog_arrival.start(START_MS, ports, parent)

		await expect(probe.has_arrived(START_MS + MINUTE_MS)).resolves.toBe(false)
		pool.issues.push('2493')
		await expect(probe.has_arrived(START_MS + MINUTE_MS + MINUTE_MS)).resolves.toBe(true)
	})
})

describe('backlog_arrival.start — a failed probe', () => {
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

		expect(backlog_arrival.arrivals(new Set(['2445']), reading, false)).toEqual(['2493'])
	})

	it('names none without a free lane', () => {
		const reading = { issues: ['2493'], free_lanes: NO_FREE }

		expect(backlog_arrival.arrivals(new Set(), reading, false)).toEqual([])
		expect(backlog_arrival.arrivals(new Set(), reading, true)).toEqual([])
	})

	// joshuafolkken/kit#3434: the baseline's issues were waiting for a lane a raise has now made.
	it('names the whole pool once the lane limit was raised', () => {
		const reading = { issues: ['2445'], free_lanes: FREE }

		expect(backlog_arrival.arrivals(new Set(['2445']), reading, true)).toEqual(['2445'])
	})
})

function watch_of(raised: { is_raised: boolean }): () => Promise<() => boolean> {
	return async () => () => raised.is_raised
}

describe('backlog_arrival.start — a raised lane limit wakes the parent', () => {
	it('wakes for a pool the baseline already holds once the limit is raised', async () => {
		const pool = { issues: ['2445'], free: FREE }
		const raised = { is_raised: false }
		const probe = await backlog_arrival.start(START_MS, ports_of(pool), parent, watch_of(raised))

		await expect(probe.has_arrived(START_MS + MINUTE_MS)).resolves.toBe(false)

		raised.is_raised = true

		await expect(probe.has_arrived(START_MS + MINUTE_MS + MINUTE_MS)).resolves.toBe(true)
	})

	it('does not wake on a raise that freed no lane', async () => {
		const pool = { issues: ['2445'], free: NO_FREE }
		const probe = await backlog_arrival.start(
			START_MS,
			ports_of(pool),
			parent,
			watch_of({ is_raised: true }),
		)

		await expect(probe.has_arrived(START_MS + MINUTE_MS)).resolves.toBe(false)
	})
})
