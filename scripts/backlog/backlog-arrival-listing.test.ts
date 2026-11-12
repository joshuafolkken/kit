import { describe, expect, it, vi } from 'vitest'
import { backlog_arrival, type ArrivalPorts } from './backlog-arrival'
import { backlog_budget } from './backlog-budget'

// joshuafolkken/kit#7229: the probe reads the backlog only once the `auto-ok` listing holds a new
// issue, so an unchanged listing — a 304 — spends no `backlog:next` read.

const START_MS = 1_000_000
const PROBE_MS = backlog_arrival.PROBE_INTERVAL_MS
const TEN_SECONDS_MS = 10_000
const FREE = 3

interface Listing {
	is_new: boolean
}

function ports_of(listing: Listing, added_at: Array<number> = []): ArrivalPorts {
	const is_changed = vi.fn(async () => listing.is_new)

	return {
		free_lane_count: vi.fn(async () => FREE),
		ready_issues: vi.fn(async () => ['2445']),
		is_added_since: vi.fn(async (since_ms: number) => added_at.some((at) => at >= since_ms)),
		observe_offerable: vi.fn<ArrivalPorts['observe_offerable']>(),
		listing_watcher: () => is_changed,
	}
}

async function parent(): Promise<boolean> {
	return true
}

function watch_of(is_raised: boolean): () => Promise<() => boolean> {
	return async () => () => is_raised
}

function arrive_next(ports: ArrivalPorts): void {
	vi.mocked(ports.ready_issues).mockResolvedValue(['2445', '2493'])
}

describe('backlog_arrival.PROBE_INTERVAL_MS', () => {
	it('is the ten-second listing check interval backlog:drive uses', () => {
		expect(backlog_arrival.PROBE_INTERVAL_MS).toBe(backlog_budget.LISTING_CHECK_INTERVAL_MS)
		expect(backlog_arrival.PROBE_INTERVAL_MS).toBe(TEN_SECONDS_MS)
	})
})

describe('backlog_arrival.start — an unchanged listing', () => {
	it('reads no backlog and records nothing while the listing stays unchanged', async () => {
		const ports = ports_of({ is_new: false })
		const probe = await backlog_arrival.start(START_MS, ports, parent)

		arrive_next(ports)

		await expect(probe.has_arrived(START_MS + PROBE_MS)).resolves.toBe(false)
		await expect(probe.has_arrived(START_MS + PROBE_MS + PROBE_MS)).resolves.toBe(false)
		expect(ports.ready_issues).toHaveBeenCalledTimes(1)
		expect(ports.free_lane_count).not.toHaveBeenCalled()
		expect(ports.observe_offerable).not.toHaveBeenCalled()
	})

	it('still wakes at the next tick for an issue run:add handed the run', async () => {
		const ports = ports_of({ is_new: false }, [START_MS + 1])
		const probe = await backlog_arrival.start(START_MS, ports, parent)

		await expect(probe.has_arrived(START_MS + 1)).resolves.toBe(true)
	})

	it('reads the backlog regardless once the lane limit is raised', async () => {
		const ports = ports_of({ is_new: false })
		const probe = await backlog_arrival.start(START_MS, ports, parent, watch_of(true))

		await expect(probe.has_arrived(START_MS + PROBE_MS)).resolves.toBe(true)
	})
})

describe('backlog_arrival.start — a changed listing', () => {
	it('takes the listing baseline at the start', async () => {
		const ports = ports_of({ is_new: false })

		await backlog_arrival.start(START_MS, ports, parent)

		expect(ports.listing_watcher()).toHaveBeenCalledTimes(1)
	})

	it('reads the backlog and wakes on an issue new to it', async () => {
		const ports = ports_of({ is_new: true })
		const probe = await backlog_arrival.start(START_MS, ports, parent)

		arrive_next(ports)

		await expect(probe.has_arrived(START_MS + PROBE_MS)).resolves.toBe(true)
		expect(ports.observe_offerable).toHaveBeenCalledWith(true)
	})

	it('does not wake when the backlog holds nothing new', async () => {
		const probe = await backlog_arrival.start(START_MS, ports_of({ is_new: true }), parent)

		await expect(probe.has_arrived(START_MS + PROBE_MS)).resolves.toBe(false)
	})

	it('reads again at the next probe when the reading after a change failed', async () => {
		const listing = { is_new: true }
		const ports = ports_of(listing)
		const probe = await backlog_arrival.start(START_MS, ports, parent)

		arrive_next(ports)
		vi.mocked(ports.free_lane_count).mockRejectedValueOnce(new Error('git worktree list failed'))

		await expect(probe.has_arrived(START_MS + PROBE_MS)).resolves.toBe(false)
		listing.is_new = false
		await expect(probe.has_arrived(START_MS + PROBE_MS + PROBE_MS)).resolves.toBe(true)
	})
})
