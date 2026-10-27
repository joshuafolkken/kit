import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#4926: a lane child that gives its lane back notes it on the stream; `run:merge`
// closes the lane with a withdrawal naming its own `lane:plan`, which the readers tell apart from a
// withdrawal that takes the issue out of the run.

const emit_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: emit_mock },
}))

const { lane_yield } = await import('./lane-yield')

const ISSUE = '4926'
const YIELD_EVENT_TEXT = `#${ISSUE} withdrawn by its own lane:plan: overlaps #4925`
const PERSON_EVENT_TEXT = `#${ISSUE} withdrawn by a person: superseded`
const OVERLAP = 'overlaps #4925'
const YIELD_NOTE_TEXT = `#${ISSUE} yielded its lane: ${OVERLAP}`

function event(pos: number, kind: string, text: string): RunEvent {
	return { pos, kind, text, at: '2026-10-26T00:00:00.000Z' }
}

const LAUNCH = event(1, 'child-launch', `#${ISSUE} dispatched`)
const YIELD_NOTE = event(2, 'note', YIELD_NOTE_TEXT)

beforeEach(() => {
	emit_mock.mockReset().mockResolvedValue(undefined)
})

describe('lane_yield.record_yield', () => {
	it('notes the yield and the overlap, rather than writing a withdrawal', async () => {
		await lane_yield.record_yield(Number(ISSUE), OVERLAP, 'summary')

		expect(emit_mock).toHaveBeenCalledWith('note', `${YIELD_NOTE_TEXT} · at: summary`)
	})

	// joshuafolkken/kit#5211: one word says whether the entry probe caught it before any reading.
	it('names a yield the entry probe caught as at the entry, still read as a yield', async () => {
		await lane_yield.record_yield(Number(ISSUE), OVERLAP, 'entry')

		const text = `${YIELD_NOTE_TEXT} · at: entry`

		expect(emit_mock).toHaveBeenCalledWith('note', text)
		expect(lane_yield.is_yielded([LAUNCH, event(2, 'note', text)], ISSUE)).toBe(true)
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
	it('reads an issue whose newest launch noted its yield as yielded', () => {
		expect(lane_yield.is_yielded([LAUNCH, YIELD_NOTE], ISSUE)).toBe(true)
	})

	it('stays yielded once run:merge closes the lane named as the yield', () => {
		const events = [LAUNCH, YIELD_NOTE, event(3, 'withdraw', YIELD_EVENT_TEXT)]

		expect(lane_yield.is_yielded(events, ISSUE)).toBe(true)
	})

	it('does not read an issue launched again after its yield as yielded', () => {
		expect(lane_yield.is_yielded([LAUNCH, YIELD_NOTE, { ...LAUNCH, pos: 3 }], ISSUE)).toBe(false)
	})

	it('does not read an issue a person withdrew after its yield as yielded', () => {
		const events = [LAUNCH, YIELD_NOTE, event(3, 'withdraw', PERSON_EVENT_TEXT)]

		expect(lane_yield.is_yielded(events, ISSUE)).toBe(false)
	})

	it('does not read an issue with no yield note as yielded', () => {
		expect(lane_yield.is_yielded([LAUNCH, event(2, 'withdraw', PERSON_EVENT_TEXT)], ISSUE)).toBe(
			false,
		)
	})
})
