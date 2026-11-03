import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import { run_wake_window } from './run-wake-window'

describe('run_wake_window — the driver window', () => {
	it('bounds the driver at five minutes, held in milliseconds too', () => {
		const five_minutes = 5

		expect(run_wake_window.WINDOW_MINUTES).toBe(five_minutes)
		expect(run_wake_window.WINDOW_MS).toBe(five_minutes * MS_PER_MINUTE)
	})
})
