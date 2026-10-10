import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { hanging_execa } from '#scripts/test/hanging-execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_load } from './lane-load'

// joshuafolkken/kit#3590: the swap probe carried no timeout, so a `sysctl` that never answered held
// the load sample — and the lane command waiting on it — open for good.

vi.mock('execa', async () => {
	const { hanging_execa: stand_in } = await import('#scripts/test/hanging-execa')

	return { execa: stand_in.spawn }
})

beforeEach(() => {
	vi.useFakeTimers()
	hanging_execa.reset()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('lane_load.read_swap_mb against a sysctl that never answers', () => {
	it('answers undefined once the probe budget is spent', async () => {
		const pending = lane_load.read_swap_mb('darwin')

		await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)

		await expect(pending).resolves.toBeUndefined()
		expect(hanging_execa.timeouts()).toStrictEqual([PROBE_TIMEOUT_MS])
	})
})
