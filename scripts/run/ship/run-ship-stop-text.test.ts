import { describe, expect, it } from 'vitest'
import { run_ship_stop_text } from './run-ship-stop-text'

describe('run_ship_stop_text', () => {
	it.each(['followup', 'review', 'conflict'])('reads back the %s stop it wrote', (reason) => {
		expect(run_ship_stop_text.reason_of(run_ship_stop_text.format('3245', reason, 'check'))).toBe(
			reason,
		)
	})

	it.each(['finding', 'infra', 'conflict', 'check'])(
		'reads back the %s cause it wrote',
		(cause) => {
			expect(run_ship_stop_text.cause_of(run_ship_stop_text.format('3245', 'gate', cause))).toBe(
				cause,
			)
		},
	)

	it('reads a stop written before it carried a cause with its reason and no cause', () => {
		const text = '#3245 review failed — pnpm josh ship --log 3245'

		expect(run_ship_stop_text.reason_of(text)).toBe('review')
		expect(run_ship_stop_text.cause_of(text)).toBeUndefined()
	})

	it('reads a text it did not write as no stop', () => {
		expect(run_ship_stop_text.reason_of('#3245 gate started')).toBeUndefined()
	})
})
