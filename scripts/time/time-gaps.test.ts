import { describe, expect, it } from 'vitest'
import { time_format } from './time-format'
import { time_gaps } from './time-gaps'
import { time_markers } from './time-markers'
import { time_phase_fixture } from './time-phase-fixture'
import { time_report } from './time-report'
import { time_report_fixture } from './time-report-fixture'
import { time_round_trips } from './time-round-trips'
import { time_spans, type Span } from './time-spans'

// The model wait a run spends per round trip, read as a distribution rather than as a mean
// (joshuafolkken/kit#1386).

const { MINUTE_MS, span } = time_phase_fixture
const MODEL = time_spans.MODEL_CATEGORY
const TOOL = time_spans.TOOL_CATEGORY
const HUMAN = time_spans.HUMAN_CATEGORY
const ELAPSED_MS = 100 * MINUTE_MS

// A turn that thought for `minutes` and then issued one call, starting at `start_minute`. Two spans
// rather than one, because a round trip is what charges a stretch of model time to anything at all.
function turn(start_minute: number, minutes: number, extra: Partial<Span> = {}): Array<Span> {
	return [
		span(start_minute, minutes, { category: MODEL }),
		span(start_minute + minutes, 1, { category: TOOL, ...extra }),
	]
}

function gap_minutes(spans: ReadonlyArray<Span>): Array<number> {
	return time_gaps.build_gaps(spans).longest.map((gap) => gap.duration_ms / MINUTE_MS)
}

function rendered(spans: ReadonlyArray<Span>): string {
	return time_gaps.gap_lines(time_gaps.build_gaps(spans), ELAPSED_MS).join('\n')
}

function line_with(text: string, needle: string): string {
	return text.split('\n').find((row) => row.includes(needle)) ?? ''
}

// The rows under the second heading, so an assertion about a stretch cannot pass on the distribution
// row above it — `max 1200.0 s` and the longest stretch's own duration are the same seconds.
function longest_rows(text: string): Array<string> {
	const lines = text.split('\n')

	return lines.slice(lines.indexOf(time_gaps.LONGEST_HEADING) + 1)
}

// Nine ordinary turns and one that thought for twenty minutes without calling anything — the shape
// run #1379 had, at a size a test can state: a median of one minute, and a maximum twenty times
// larger. The `Edit` marker on the first call opens the implementation window, so the stretches carry
// a phase name a reader would act on rather than the `other` a marker-less timeline classifies to.
const ONE_LONG_THINK: Array<Span> = [
	...turn(0, 1, { marker: time_markers.EDIT_MARKER }),
	...Array.from({ length: 8 }, (_unused, index) => turn((index + 1) * 2, 1)).flat(),
	...turn(20, 20),
]

describe('time_gaps.build_gaps', () => {
	// The acceptance criterion, at the level of two figures: the median and the maximum are read
	// separately, and the one long stretch does not move the median it is invisible in.
	it('reports the typical stretch and the worst one as separate figures', () => {
		const { distribution } = time_gaps.build_gaps(ONE_LONG_THINK)

		expect(distribution.median_ms).toBe(MINUTE_MS)
		expect(distribution.max_ms).toBe(20 * MINUTE_MS)
		// **The p90 is not the max, and that is the point of carrying both.** Nine of these ten stretches
		// were ordinary, so the ninetieth percentile says the long one was alone — which is what decides
		// whether a run is slow everywhere or slow once.
		expect(distribution.p90_ms).toBe(MINUTE_MS)
	})

	// **The mean and the distribution share a denominator.** The price the round-trip block prints is
	// `issuing_model_ms / round_trip_count`, so a distribution built over fewer readings would sit above
	// the mean printed beside it — one report disagreeing with itself. That the two also share a
	// *numerator* is `time-round-trips.test.ts`'s case, not a second copy of it here.
	it('samples once per round trip, which is what the mean beside it divides by', () => {
		const { distribution } = time_gaps.build_gaps(ONE_LONG_THINK)

		expect(distribution.sample_count).toBe(time_round_trips.count_round_trips(ONE_LONG_THINK))
	})

	// A round trip opened with nothing pending — the call that follows a person typing — is a stretch
	// of zero rather than a stretch that did not happen. Dropping it would put the distribution above
	// the mean, which divides by every round trip.
	it('counts a round trip opened after a human wait as a stretch of zero', () => {
		const spans = [...turn(0, 4), span(5, 3, { category: HUMAN }), span(8, 1, { category: TOOL })]
		const { distribution } = time_gaps.build_gaps(spans)

		expect(distribution.sample_count).toBe(2)
		expect(distribution.min_ms).toBe(0)
		expect(distribution.max_ms).toBe(4 * MINUTE_MS)
	})

	// **Ranked by length rather than left in run order**, which is the treatment the segment table
	// already gets: the top of the list is what a reader is looking for.
	it('keeps the longest stretches rather than the first ones', () => {
		const spans = [...turn(0, 2), ...turn(10, 9), ...turn(30, 5)]

		expect(gap_minutes(spans)).toEqual([9, 5, 2])
	})

	it('prints no more than the longest few, however many round trips the run made', () => {
		expect(gap_minutes(ONE_LONG_THINK)).toHaveLength(time_gaps.MAX_LONGEST)
	})
})

describe('time_gaps.build_gaps — the phase a stretch belongs to', () => {
	// The acceptance criterion that a length alone cannot meet: twenty minutes of thinking during
	// implementation and twenty during rework are different findings. The `Edit` marker opens the
	// implementation window and the first `josh gate` call closes it, which is the same classification
	// the phase table itself is built from.
	const EDIT = { marker: time_markers.EDIT_MARKER }
	const GATE = { josh_command: time_phase_fixture.GATE_COMMAND }
	const RUN: Array<Span> = [
		...turn(0, 2, EDIT),
		...turn(10, 9),
		...turn(30, 5, GATE),
		...turn(40, 7),
	]

	it('names the phase the longest stretch was spent in', () => {
		const [longest] = time_gaps.build_gaps(RUN).longest

		expect(longest?.duration_ms).toBe(9 * MINUTE_MS)
		expect(longest?.phase).toBe('implement')
	})

	it('tells two stretches of different phases apart', () => {
		const phases = time_gaps.build_gaps(RUN).longest.map((gap) => gap.phase)

		expect(phases).toEqual(['implement', 'rework', 'implement', 'setup'])
	})
})

describe('time_gaps.gap_lines', () => {
	it('puts the median in the numeric column and the spread in the suffix', () => {
		const row = line_with(rendered(ONE_LONG_THINK), time_gaps.GAP_LABEL)

		expect(row).toContain('60.0 s')
		expect(row).toContain('min 60.0 s')
		expect(row).toContain('p90 60.0 s')
		expect(row).toContain('max 1200.0 s')
	})

	// The share is what makes one stretch worth reading about: twenty minutes is a number, and 20% of
	// the run is the reason it outranks every command in the table below it.
	it('lists the longest stretches with their phase and their share of the run', () => {
		const text = rendered(ONE_LONG_THINK)
		const [row] = longest_rows(text)

		expect(text).toContain(time_gaps.LONGEST_HEADING)
		expect(row).toContain('1200.0 s')
		expect(row).toContain('implement')
		expect(row).toContain('20.0% of elapsed')
	})

	// The acceptance criterion at the level of one line: a transcript nobody read has no stretches, and
	// a median of `0.0 s` would report the fastest possible run for a scope nobody measured.
	it('withholds the whole distribution where no span was read', () => {
		const text = rendered([])

		expect(text).toContain(time_format.NOT_MEASURED)
		expect(text).not.toContain('0.0 s')
		expect(text).not.toContain(time_gaps.LONGEST_HEADING)
	})

	// A transcript that *was* read but called nothing has no round trip to distribute over — the same
	// answer, in the same words, the price row one block above gives.
	it('withholds it where the transcript was read but made no round trip', () => {
		const text = rendered([span(0, 4, { category: MODEL }), span(4, 2, { category: HUMAN })])

		expect(text).toContain(time_format.NO_CALLS)
		expect(text).not.toContain(time_format.NOT_MEASURED)
		expect(text).not.toContain('0.0 s')
	})
})

// Where the block sits in the report a person reads. Here rather than in `time-report.test.ts`, which
// is at its line ceiling — the seam every other block's suite is already cut along.
describe('time_report.format_report — the model-gap block', () => {
	// The spread of the very model wait the price row is the mean of, so it sits directly beneath that
	// row rather than at the end of the report.
	it('prints the distribution beneath the price it is the spread of', () => {
		const text = time_report.format_report(time_report_fixture.build(ONE_LONG_THINK))

		expect(text.indexOf(time_gaps.HEADING)).toBeGreaterThan(
			text.indexOf(time_report.ROUND_TRIP_HEADING),
		)
		expect(text).toContain(time_gaps.GAP_LABEL)
	})

	it('carries the distribution into the machine-readable report', () => {
		const report = time_report_fixture.build(ONE_LONG_THINK)

		expect(report.gaps.distribution.median_ms).toBe(MINUTE_MS)
		expect(report.gaps.distribution.max_ms).toBe(20 * MINUTE_MS)
	})
})
