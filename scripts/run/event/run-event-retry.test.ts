import { expect, it } from 'vitest'
import { run_event_retry } from './run-event-retry'
import type { RunEvent } from './run-event-stream'

const PARKED = '#5413 parked'

function event(pos: number, kind: string, text: string): RunEvent {
	return { pos, kind, text, at: '2026-10-30T00:00:00.000Z' }
}

it('keeps only the newest attempt per retried issue and preserves other history', () => {
	const old = event(1, 'park', PARKED)
	const other = event(2, 'park', '#5400 parked')
	const retry = event(3, 'add', run_event_retry.text_of(5413))
	const stop = event(4, 'park', '#5413 stopped again')
	const again = event(5, 'add', run_event_retry.text_of(5413))

	expect(run_event_retry.current_attempts([old, other, retry, stop, again])).toStrictEqual([
		other,
		again,
	])
})

it('keeps parks on ordinary additions and ignores unrelated add text', () => {
	const events = [event(1, 'park', PARKED), event(2, 'add', 'added #5413')]

	expect(run_event_retry.current_attempts(events)).toStrictEqual(events)
	expect(run_event_retry.is_retry(event(3, 'note', 'retry #5413'))).toBe(false)
})
