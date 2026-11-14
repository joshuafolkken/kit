import { run_wake_takeover } from '#scripts/run/wake/run-wake-takeover'
import { run_wake_window } from '#scripts/run/wake/run-wake-window'
import { describe, expect, it } from 'vitest'
import { backlog_budget } from './backlog-budget'
import { backlog_dispatch_bound } from './backlog-dispatch-bound'

// joshuafolkken/kit#7507: from an issue becoming ready to its `child-launch`, the longest each state can
// take — the wait before the change is noticed, plus a fresh driver's start where one has to start.

const { DISPATCH_BOUND_MS, DRIVER_START_MS, NOTICE_MS } = backlog_dispatch_bound

const WORST_CASES = [
	{ state: 'a lane runs and a seat is free', wait_ms: backlog_budget.LISTING_CHECK_INTERVAL_MS },
	{
		state: 'no lane runs and a named issue is left',
		wait_ms: backlog_budget.IDLE_OFFER_INTERVAL_MS,
	},
	{
		state: 'the driver window ends before the listing check',
		wait_ms: backlog_budget.LISTING_CHECK_INTERVAL_MS + DRIVER_START_MS,
	},
	{
		state: 'the supervisor pauses between passes',
		wait_ms: run_wake_window.PASS_INTERVAL_MS + DRIVER_START_MS,
	},
	{
		state: 'the supervisor reloads',
		wait_ms: run_wake_takeover.TAKEOVER_WAIT_MS + DRIVER_START_MS,
	},
]

describe('backlog_dispatch_bound', () => {
	it('bounds a dispatch at one minute', () => {
		const one_minute_ms = 60_000

		expect(DISPATCH_BOUND_MS).toBe(one_minute_ms)
	})

	it('leaves what a fresh driver start does not spend to notice a change', () => {
		expect(NOTICE_MS + DRIVER_START_MS).toBe(DISPATCH_BOUND_MS)
	})

	it.each(WORST_CASES)('dispatches within the bound while $state', ({ wait_ms }) => {
		expect(wait_ms).toBeLessThanOrEqual(DISPATCH_BOUND_MS)
	})
})
