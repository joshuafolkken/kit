import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4926: a lane child that gives its lane back writes a `withdraw` event naming its own
// `lane:plan`, which the readers tell apart from a withdrawal that takes the issue out of the run.

const emit_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: emit_mock },
}))

const { lane_yield } = await import('./lane-yield')

const ISSUE = '4926'
const YIELD_EVENT_TEXT = `#${ISSUE} withdrawn by its own lane:plan: overlaps #4925`
const PERSON_EVENT_TEXT = `#${ISSUE} withdrawn by a person: superseded`

function event(pos: number, kind: string, text: string): RunEvent {
	return { pos, kind, text, at: '2026-10-26T00:00:00.000Z' }
}

const LAUNCH = event(1, 'child-launch', `#${ISSUE} dispatched`)

beforeEach(() => {
	emit_mock.mockReset().mockResolvedValue(undefined)
})

describe('lane_yield.record_yield', () => {
	it('writes a withdraw event naming its own lane:plan and the overlap', async () => {
		await lane_yield.record_yield(Number(ISSUE), 'overlaps #4925')

		expect(emit_mock).toHaveBeenCalledWith('withdraw', YIELD_EVENT_TEXT)
	})
})

describe('lane_yield.is_yield', () => {
	it('reads its own withdraw event as a yield', () => {
		expect(lane_yield.is_yield(event(2, 'withdraw', YIELD_EVENT_TEXT))).toBe(true)
	})

	it("does not read a person's withdrawal as a yield", () => {
		expect(lane_yield.is_yield(event(2, 'withdraw', PERSON_EVENT_TEXT))).toBe(false)
	})
})

describe('lane_yield.is_yielded', () => {
	it('reads an issue whose newest launch ended in its yield as yielded', () => {
		expect(lane_yield.is_yielded([LAUNCH, event(2, 'withdraw', YIELD_EVENT_TEXT)], ISSUE)).toBe(
			true,
		)
	})

	it('does not read an issue launched again after its yield as yielded', () => {
		const events = [LAUNCH, event(2, 'withdraw', YIELD_EVENT_TEXT), { ...LAUNCH, pos: 3 }]

		expect(lane_yield.is_yielded(events, ISSUE)).toBe(false)
	})

	it('does not read an issue a person withdrew as yielded', () => {
		expect(lane_yield.is_yielded([LAUNCH, event(2, 'withdraw', PERSON_EVENT_TEXT)], ISSUE)).toBe(
			false,
		)
	})
})
