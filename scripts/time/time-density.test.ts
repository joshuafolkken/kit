import { describe, expect, it } from 'vitest'
import { time_density, type DensityReading } from './time-density'
import { time_round_trips } from './time-round-trips'
import { time_transcript_fixture } from './time-transcript-fixture'

const { density_text, turn_lines, turn_call_line, prompt_line, BRANCH } = time_transcript_fixture

const ENOUGH_TURNS = time_transcript_fixture.DENSITY_TURNS
const ONE_CALL = 1
const TWO_CALLS = 2
const THREE_CALLS = 3
// A cut inside the transcript's first line, which is what a tail read hands over.
const MID_LINE_OFFSET = 5
const UNBATCHED_DENSITY = 1
const BATCHED_DENSITY = 3
const RECENTLY_MS = 1000

function reading(overrides: Partial<DensityReading> = {}): DensityReading {
	return {
		density: UNBATCHED_DENSITY,
		round_trip_count: ENOUGH_TURNS,
		turn_calls: ONE_CALL,
		...overrides,
	}
}

describe('time_density.last_turn_calls', () => {
	it('counts every call the newest assistant message issued, across its lines', () => {
		const text = [...turn_lines(0, ONE_CALL), ...turn_lines(1, THREE_CALLS)].join('\n')

		expect(time_density.last_turn_calls(text)).toBe(THREE_CALLS)
	})

	it('reports one for a turn that issued a single call after one that batched', () => {
		const text = [...turn_lines(0, THREE_CALLS), ...turn_lines(1, ONE_CALL)].join('\n')

		expect(time_density.last_turn_calls(text)).toBe(ONE_CALL)
	})

	// The empty id is every untagged line's id, so grouping on it would answer with the whole window.
	it('reports nothing when the newest assistant line carries no message id', () => {
		const text = [prompt_line(0, BRANCH), time_transcript_fixture.call_line(1, BRANCH)].join('\n')

		expect(time_density.last_turn_calls(text)).toBe(0)
	})

	it('reports nothing for a transcript with no assistant line at all', () => {
		expect(time_density.last_turn_calls(prompt_line(0, BRANCH))).toBe(0)
	})
})

describe('time_density.read_window', () => {
	it('reports one call per round trip for a run that batches nothing', () => {
		const result = time_density.read_window(density_text(ENOUGH_TURNS, ONE_CALL))

		expect(result.density).toBe(UNBATCHED_DENSITY)
		expect(result.round_trip_count).toBe(ENOUGH_TURNS)
		expect(result.turn_calls).toBe(ONE_CALL)
	})

	it('reports the batch size for a run that issues its calls together', () => {
		const result = time_density.read_window(density_text(ENOUGH_TURNS, THREE_CALLS))

		expect(result.density).toBe(BATCHED_DENSITY)
		expect(result.round_trip_count).toBe(ENOUGH_TURNS)
		expect(result.turn_calls).toBe(THREE_CALLS)
	})

	// The caller hands over a tail, whose first line is usually cut mid-way.
	it('reads a window whose leading line is truncated', () => {
		const result = time_density.read_window(
			density_text(ENOUGH_TURNS, ONE_CALL).slice(MID_LINE_OFFSET),
		)

		expect(result.density).toBe(UNBATCHED_DENSITY)
	})

	it('reports no density for a transcript that could not be read', () => {
		expect(time_density.read_window('').density).toBe(0)
	})
})

describe('time_density.is_due', () => {
	it('is due for an unbatched turn in a run under the floor', () => {
		expect(time_density.is_due(reading(), time_density.NOTICE_INTERVAL_MS)).toBe(true)
	})

	it('withholds the line again until the interval has passed', () => {
		expect(time_density.is_due(reading(), RECENTLY_MS)).toBe(false)
	})

	it('withholds it from a run already clearing the floor', () => {
		const clearing = reading({ density: time_round_trips.CALLS_PER_ROUND_TRIP_FLOOR })

		expect(time_density.is_due(clearing, time_density.NOTICE_INTERVAL_MS)).toBe(false)
	})

	it('withholds it from a turn that did batch', () => {
		const batched = reading({ turn_calls: THREE_CALLS })

		expect(time_density.is_due(batched, time_density.NOTICE_INTERVAL_MS)).toBe(false)
	})

	// Zero means the newest message could not be identified, never "a turn that called nothing".
	it('withholds it when the turn could not be read', () => {
		const unread = reading({ turn_calls: 0 })

		expect(time_density.is_due(unread, time_density.NOTICE_INTERVAL_MS)).toBe(false)
	})

	it('withholds it from a window too small to have a density worth quoting', () => {
		const thin = reading({ round_trip_count: time_density.MIN_ROUND_TRIPS - 1 })

		expect(time_density.is_due(thin, time_density.NOTICE_INTERVAL_MS)).toBe(false)
	})
})

describe('time_density.format_notice', () => {
	it('quotes the density, the floor and the sample it was taken over', () => {
		const line = time_density.format_notice(reading())

		expect(line).toContain('1.00 calls per round trip')
		expect(line).toContain(String(ENOUGH_TURNS))
		expect(line).toContain('1.50 floor')
	})

	it('names the resident rule rather than restating it, and stays one line', () => {
		const line = time_density.format_notice(reading())

		expect(line).toContain('CLAUDE.md')
		expect(line).not.toContain('\n')
	})
})

describe('time_density.last_turn_calls — a partial newest turn', () => {
	// At hook time the calls are written but their results are not, so the count must not wait on them.
	it('counts a turn whose results have not been written yet', () => {
		const started = [
			...turn_lines(0, ONE_CALL),
			turn_call_line(THREE_CALLS, 'msg-1', 'later-a'),
			turn_call_line(THREE_CALLS, 'msg-1', 'later-b'),
		].join('\n')

		expect(time_density.last_turn_calls(started)).toBe(TWO_CALLS)
	})
})
