import { time_markers } from './time-markers'
import type { Span } from './time-spans'

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
		is_continuation: false,
		ended_ms: 0,
		duration_ms: minutes * MINUTE_MS,
	}
}

const time_span_fixture = { MINUTE_MS, span }

export { time_span_fixture }
