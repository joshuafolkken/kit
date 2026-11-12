import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_plan_wait_event } from './lane-plan-wait-event'

// joshuafolkken/kit#6140: each `lane:plan` ask that blocks on a holder writes a start and an end, read
// back as the wait `lane:breakdown` counts under its own row.

const { EVENT_KIND } = run_event_stream
const START = Date.parse('2026-11-03T10:30:00.000Z')
const MINUTE_MS = 60_000
const PAIR = { issue: 6035, holder: 6036 }
const ROW = 'lane:plan wait (#6036)'
const WAIT_START = '#6035 start #6036'
const WAIT_END = '#6035 end #6036'
const BETWEEN = 'between ship stages'

afterEach(() => {
	vi.restoreAllMocks()
})

function event(minute: number, text: string, kind: string = EVENT_KIND.PLAN_WAIT): RunEvent {
	return { pos: minute, at: new Date(START + minute * MINUTE_MS).toISOString(), kind, text }
}

describe('lane_plan_wait_event.timed', () => {
	it('writes a start before the wait and an end after it, naming the lane and the holder', async () => {
		const written: Array<string> = []
		const emit = vi.spyOn(run_event_stream_emit, 'emit').mockImplementation(async (kind, text) => {
			written.push(`${kind} ${text}`)
		})

		const end = await lane_plan_wait_event.timed(PAIR, async () => {
			written.push('waited')

			return 'again'
		})

		expect(end).toBe('again')
		expect(emit).toHaveBeenCalledTimes(2)
		expect(written).toStrictEqual([`plan-wait ${WAIT_START}`, 'waited', `plan-wait ${WAIT_END}`])
	})

	it('writes the end when the wait throws', async () => {
		const emit = vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()

		await expect(
			lane_plan_wait_event.timed(PAIR, async () => {
				throw new Error('listing')
			}),
		).rejects.toThrow('listing')
		expect(emit).toHaveBeenLastCalledWith(EVENT_KIND.PLAN_WAIT, WAIT_END)
	})
})

describe('lane_plan_wait_event.spans', () => {
	it('pairs each end with its start, for this lane only', () => {
		const events = [
			event(0, WAIT_START),
			event(1, '#6099 start #6036'),
			event(9, WAIT_END),
			event(10, WAIT_START),
			event(19, WAIT_END),
			event(20, WAIT_START),
		]

		expect(lane_plan_wait_event.spans(events, PAIR.issue)).toStrictEqual([
			{ from_ms: START, to_ms: START + 9 * MINUTE_MS, name: ROW },
			{ from_ms: START + 10 * MINUTE_MS, to_ms: START + 19 * MINUTE_MS, name: ROW },
		])
	})

	it('reads no wait off another kind or an end with no start', () => {
		const events = [event(0, WAIT_START, 'note'), event(9, WAIT_END)]

		expect(lane_plan_wait_event.spans(events, PAIR.issue)).toStrictEqual([])
	})
})

describe('lane_plan_wait_event.carved', () => {
	it('cuts each wait out of the stage it fell in, the rest left to that stage', () => {
		const segment = { stage: BETWEEN, from_ms: 0, to_ms: 100 }
		const waits = [
			{ from_ms: 10, to_ms: 40, name: ROW },
			{ from_ms: 90, to_ms: 120, name: ROW },
		]

		expect(lane_plan_wait_event.carved([segment], waits)).toStrictEqual([
			{ stage: BETWEEN, from_ms: 0, to_ms: 10 },
			{ stage: ROW, from_ms: 10, to_ms: 40 },
			{ stage: BETWEEN, from_ms: 40, to_ms: 90 },
			{ stage: ROW, from_ms: 90, to_ms: 100 },
		])
	})
})
