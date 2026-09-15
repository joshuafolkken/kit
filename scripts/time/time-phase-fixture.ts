import { time_markers } from '#scripts/time-runtime/time-markers'
import { time_spans, type Span } from '#scripts/time-runtime/time-spans'

// A span positioned on a clock, for the background suite that measures how a launch's window slices a
// timeline (joshuafolkken/kit#1299, joshuafolkken/kit#1662). The windows are decided from when a span
// sits, so a test has to read as a timeline rather than as a list of durations.

const MINUTE_MS = 60_000

// The two `pnpm josh <cmd>` names a background launch is read off, written once so a suite cannot
// mistype one into a span that then quietly belongs to no command phase at all.
const GATE_COMMAND = 'josh gate'
const PR_COMMAND = 'josh git'

// The one pairing `equal_durations` cannot enforce from inside the literal: `extra` is a
// `Partial<Span>`, so a case overriding `duration_ms` alone would leave `own_duration_ms` at the
// length this call was built with, and the drift would surface only as a wrong number in a
// per-invocation assertion (joshuafolkken/kit#1591). Re-derived here unless the case named it.
function paired(merged: Span, extra: Partial<Span>): Span {
	return { ...merged, own_duration_ms: extra.own_duration_ms ?? merged.duration_ms }
}

// The fields no case varies, written once so a new `Span` field lands in one literal — the same
// pattern `time-span-fixture.ts` uses, and what keeps `base_span` inside the per-function line limit.
const UNVARIED = {
	category: time_spans.TOOL_CATEGORY,
	label: '',
	josh_command: '',
	josh_commands: [],
	check_key: '',
	marker: time_markers.NO_MARKER,
	is_bundleable: false,
	is_writing: false,
	has_prior_reference: false,
	targets: [],
	writes: [],
	message_id: time_spans.NO_MESSAGE_ID,
	issue: time_markers.NO_ISSUE,
	branch: 'main',
	call_id: '',
	outcome: time_spans.UNKNOWN_OUTCOME,
	refusal_guard: '',
	followup_stages: [],
	is_continuation: false,
	...time_spans.no_background(),
} satisfies Partial<Span>

function base_span(start_minute: number, minutes: number, extra: Partial<Span>): Span {
	return {
		...UNVARIED,
		ended_ms: (start_minute + minutes) * MINUTE_MS,
		...time_spans.equal_durations(minutes * MINUTE_MS),
		...extra,
	}
}

// Positioned by start minute so a test reads as a timeline rather than as a list of durations: the
// windows are decided from when a span sits, and a helper that only carried lengths could not say.
function span(start_minute: number, minutes: number, extra: Partial<Span> = {}): Span {
	return paired(base_span(start_minute, minutes, extra), extra)
}

const time_phase_fixture = {
	MINUTE_MS,
	GATE_COMMAND,
	PR_COMMAND,
	span,
}

export { time_phase_fixture }
