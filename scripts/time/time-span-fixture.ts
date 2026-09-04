import { time_markers } from './time-markers'
import { time_spans, type Span, type SpanOutcome } from './time-spans'

// A span built by category, for the suites that measure how spans are *classified* rather than when
// they happened (joshuafolkken/kit#1304).
//
// `time-report.test.ts` and `time-round-trips.test.ts` both need exactly this shape — a category, a
// duration, and the label a table row is keyed by — and a second copy of it beside the second suite
// is the clone `CLAUDE.md` prohibits, in the one place a drift would make the two disagree about
// what a span is. The two builders that stay separate are genuinely different questions:
// `time-phases.test.ts` positions a span on a clock, and `time-transcript-fixture.ts` writes one to
// a file.

const MINUTE_MS = 60_000
const DEFAULT_MINUTES = 1

function span(
	category: Span['category'],
	minutes: number = DEFAULT_MINUTES,
	label = '',
	josh_command = '',
): Span {
	return {
		category,
		label,
		josh_command,
		marker: time_markers.NO_MARKER,
		branch: 'main',
		outcome: time_spans.UNKNOWN_OUTCOME,
		is_continuation: false,
		ended_ms: 0,
		duration_ms: minutes * MINUTE_MS,
	}
}

// The same span with an outcome and a position on the clock, for the suites that measure rework
// (joshuafolkken/kit#1309). A re-run is decided from the order the calls went out in, so a case about
// one has to say *when* each span sat — which the builder above deliberately does not, because every
// case it was written for reads a list of durations.
function outcome_span(
	end_minute: number,
	outcome: SpanOutcome,
	label: string,
	josh_command = '',
): Span {
	return {
		...span(time_spans.TOOL_CATEGORY, DEFAULT_MINUTES, label, josh_command),
		outcome,
		ended_ms: end_minute * MINUTE_MS,
	}
}

const time_span_fixture = { MINUTE_MS, span, outcome_span }

export { time_span_fixture }
