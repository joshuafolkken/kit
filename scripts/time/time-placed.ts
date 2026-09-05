import { time_phases, type PhaseName } from './time-phases'
import { time_round_trips } from './time-round-trips'
import type { Span } from './time-spans'

// A run's spans in time order with the phase each belongs to beside it (joshuafolkken/kit#1383).
//
// **Two modules already did this and a third was about to**, which is the clone `CLAUDE.md`
// prohibits: `time-segments.ts` cuts the run wherever the phase changes, `time-gaps.ts` names the
// phase each long model gap sat in, and `time-single-checks.ts` asks which of a run's single checks
// sat in the fix phase. The two calls are cheap; what drifts is the pair of decisions around them —
// that the ordering happens **before** the classification, and that a span the classifier had nothing
// to say about falls to `other` rather than to whatever the reader defaults it to.
//
// **Ordered before it is classified, not assumed ordered.** A delegated unit's spans are appended
// after the parent's and `time-corpus.ts` concatenates one session after another, so array order says
// nothing about time. `time_phases.classify` answers in the order it is handed, so classifying the
// unordered array and then sorting would pair every span with somebody else's phase.
//
// **The windows are the same either way.** `classify` builds them from the whole array by searching
// for the earliest span matching each boundary, so sorting first changes which index a phase lands at
// and never which phase a span gets.

interface Placed {
	span: Span
	phase: PhaseName
}

function placed_spans(spans: ReadonlyArray<Span>): Array<Placed> {
	const ordered = time_round_trips.in_time_order(spans)
	const phases = time_phases.classify(ordered)

	return ordered.map((span, index) => ({
		span,
		phase: phases[index] ?? time_phases.OTHER_PHASE,
	}))
}

const time_placed = { placed_spans }

export type { Placed }
export { time_placed }
