import { describe, expect, it } from 'vitest'
import { time_trips, type TripFacts } from './time-trips'

// The shape run #1864 had (joshuafolkken/kit#1875): 177 assistant turns, 149 of which issued a call —
// so 28 turns called no tool at all, a count no other row here reports.
const MEASURED: TripFacts = {
	span_count: 279,
	turn_count: 177,
	tool_call_count: 279,
	round_trip_count: 149,
	batched_turn_count: 92,
	single_call_turn_count: 57,
	ms_per_round_trip: 20_000,
	model_ms_per_round_trip: 14_400,
}

function toolless_line(facts: TripFacts): string | undefined {
	return time_trips.trip_lines(facts).find((line) => line.includes(time_trips.TOOLLESS_TURNS_LABEL))
}

describe('time_trips.trip_lines — tool-less turns', () => {
	// `turn_count` counts every assistant message; `round_trip_count` only the ones that issued a call,
	// so the difference is the pure-utterance turns `Bundling:` structurally cannot see.
	it('counts the tool-less turns as turn_count minus round trips', () => {
		expect(toolless_line(MEASURED)).toContain('28')
	})

	// Round trips are a subset of turns, so the difference is never negative; the clamp guards a
	// malformed transcript rather than reporting one.
	it('reads zero when every turn issued a call', () => {
		const facts = { ...MEASURED, turn_count: 149, round_trip_count: 149 }

		expect(toolless_line(facts)).toContain('0')
	})

	// A transcript that was not read says so on the tool-less row too, rather than reporting zero.
	it('marks the row unmeasured when no transcript was read', () => {
		const facts = { ...MEASURED, span_count: 0 }

		expect(toolless_line(facts)).toBeDefined()
	})
})
