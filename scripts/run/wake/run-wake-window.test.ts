import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { backlog_dispatch_bound } from '#scripts/backlog/backlog-dispatch-bound'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import { run_wake_window } from './run-wake-window'

describe('run_wake_window — the driver window', () => {
	it('bounds the driver at five minutes, held in milliseconds too', () => {
		const five_minutes = 5

		expect(run_wake_window.WINDOW_MINUTES).toBe(five_minutes)
		expect(run_wake_window.WINDOW_MS).toBe(five_minutes * MS_PER_MINUTE)
	})

	// joshuafolkken/kit#6718: stretching the offer interval must not slow the supervisor's passes;
	// joshuafolkken/kit#7507: the pause is what the dispatch bound leaves after a driver's start.
	it('pauses what the dispatch bound leaves between passes, shorter than the offer interval', () => {
		expect(run_wake_window.PASS_INTERVAL_MS).toBe(backlog_dispatch_bound.NOTICE_MS)
		expect(run_wake_window.PASS_INTERVAL_MS).toBeLessThan(backlog_budget.OFFER_INTERVAL_MS)
	})
})
