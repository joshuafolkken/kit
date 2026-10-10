import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { hanging_execa } from '#scripts/test/hanging-execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_load } from './lane-load'
import { lane_registry } from './lane-registry'

// joshuafolkken/kit#3590: the swap probe carried no timeout, so a `sysctl` that never answered held
// the load sample — and the lane command waiting on it — open for good. joshuafolkken/kit#3593: the
// sample now takes `machine_capacity`'s reading, and stays bounded by that probe's budget.

vi.mock('execa', async () => {
	const { hanging_execa: stand_in } = await import('#scripts/test/hanging-execa')

	return { execa: stand_in.spawn }
})

const AT = '2026-10-10T00:00:00.000Z'

beforeEach(() => {
	vi.useFakeTimers()
	hanging_execa.reset()
	vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
	vi.spyOn(lane_registry, 'list_lanes').mockResolvedValue([])
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe('lane_load.sample against a sysctl that never answers', () => {
	it('records the sample without memory once the probe budget is spent', async () => {
		const pending = lane_load.sample(AT)

		await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)

		await expect(pending).resolves.toMatchObject({ available_mb: undefined, swapped_mb: undefined })
		expect(hanging_execa.timeouts()).toStrictEqual([PROBE_TIMEOUT_MS])
	})
})
