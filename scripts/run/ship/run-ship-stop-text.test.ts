import { describe, expect, it } from 'vitest'
import { run_ship_stop_text } from './run-ship-stop-text'

describe('run_ship_stop_text', () => {
	it.each(['followup', 'review', 'conflict'])('reads back the %s stop it wrote', (reason) => {
		expect(run_ship_stop_text.reason_of(run_ship_stop_text.format('3245', reason))).toBe(reason)
	})

	it('reads a text it did not write as no stop', () => {
		expect(run_ship_stop_text.reason_of('#3245 gate started')).toBeUndefined()
	})
})
