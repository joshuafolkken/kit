import { describe, expect, it } from 'vitest'
import { core_budget_timing } from './core-budget-timing'

const DEFAULT_POLL_MS = 50
const DEFAULT_CAP_MS = 120_000
const DEFAULT_EASE_MS = 30_000
const CAP_MS = 10

function now(): number {
	return 1
}

describe('core_budget_timing.resolve_timing — the clock and cadence a wait runs on', () => {
	it('defaults to the wall clock, a 50 ms poll, a two-minute cap and a 30 s ease window', () => {
		const timing = core_budget_timing.resolve_timing({})

		expect(timing.now).toBe(Date.now)
		expect(timing.poll_interval_ms).toBe(DEFAULT_POLL_MS)
		expect(timing.wait_cap_ms).toBe(DEFAULT_CAP_MS)
		expect(timing.ease_window_ms).toBe(DEFAULT_EASE_MS)
	})

	it('keeps an injected clock and cap', () => {
		const timing = core_budget_timing.resolve_timing({ now, wait_cap_ms: CAP_MS })

		expect(timing.now).toBe(now)
		expect(timing.wait_cap_ms).toBe(CAP_MS)
	})

	it('sleeps by default on a timer that resolves', async () => {
		await expect(core_budget_timing.resolve_timing({}).sleep(0)).resolves.toBeUndefined()
	})
})
