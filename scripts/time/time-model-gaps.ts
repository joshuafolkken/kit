import { time_round_trips } from './time-round-trips'
import type { Span } from './time-spans'

// The model wait one round trip was composed over, as the stretch it actually was
// (joshuafolkken/kit#1386).
//
// It moved out of `time-round-trips.ts` when that file passed its length limit
// (joshuafolkken/kit#1406) — the seam `time-gaps.ts` and `time-bundles.ts` are already cut along,
// where one module owns a walk and another renders what it found. The grouping stays next door and is
// **read** rather than restated: `opens_round_trip` is what pushes a stretch here and a group there,
// so the two lists are the same length by construction rather than by assumption.

const NONE = 0

// One round trip's share of the model wait. The price the report prints is the mean of these; a run's
// longest single stretch — 189 seconds of run #1379, 12% of the whole run — is invisible in that mean
// and is exactly what this record keeps.
interface ModelGap {
	duration_ms: number
	started_ms: number
	ended_ms: number
	// Where the stretch began, as an index into the time-ordered spans: the first model span of it, or
	// the round trip's own opener where nothing preceded it. An index rather than a phase name, because
	// this module classifies nothing — `time-gaps.ts` reads the phase off it, so the two cannot come to
	// order the spans differently.
	span_index: number
}

// A span with the position it holds in the ordered array, which is what carries the phase across.
interface Indexed {
	index: number
	span: Span
}

// The stretch currently accumulating, and the stretches already charged to a round trip.
//
// `open` is the gap of the round trip still taking calls (joshuafolkken/kit#1406). A turn issuing
// several calls composes between them, and that composing time belongs to the one round trip the turn
// opened — held by reference so the later calls extend the stretch already pushed, exactly as
// `TripWalk.open` holds the group they are pushed into.
interface GapWalk {
	pending: Array<Indexed>
	gaps: Array<ModelGap>
	open: ModelGap | undefined
}

// **A round trip opened with nothing pending is a gap of zero, not a gap that did not happen.** The
// mean the report already prints divides the whole issuing time by the round-trip count, so a
// distribution that dropped those would sit above the mean beside it — one report disagreeing with
// itself about the same quantity.
//
// **The window ends where the last member ended, not where the durations add up to.** The two agree
// only where consecutive model spans tile, and this walk names two places they do not: a turn that
// bracketed a delegated unit, and a session seam `time_corpus` concatenated with nothing in between.
// The duration would be right either way; the *window* is what a reader takes back to the transcript
// to find the turn behind a figure, so a start plus a sum would send them to the wrong one. An empty
// stretch has no last member and is stood in for by the opener, which gives it a window of zero
// length at the instant the round trip opened.
function to_gap(pending: ReadonlyArray<Indexed>, opener: Indexed): ModelGap {
	const first = pending[0] ?? opener
	const last = pending.at(-1)
	const duration_ms = pending.reduce((sum, entry) => sum + entry.span.duration_ms, NONE)

	return {
		duration_ms,
		started_ms: time_round_trips.started_ms(first.span),
		ended_ms: last?.span.ended_ms ?? time_round_trips.started_ms(opener.span),
		span_index: first.index,
	}
}

// The composing a turn did between two of its own calls, added to the stretch that turn already
// opened (joshuafolkken/kit#1406). **A round trip is a whole turn, so its price is that whole turn's
// model time** — dropping the part written between the second and third `tool_use` blocks would price
// a batched turn below what removing it returns, and `time-bundles.ts` and `time-single-checks.ts`
// both multiply that price out as a saving. Nothing pending is the adjacent-call case, where the two
// results arrived together and there is no composing between them to charge.
function absorb(gap: ModelGap | undefined, pending: ReadonlyArray<Indexed>): void {
	const last = pending.at(-1)

	if (gap === undefined || last === undefined) return

	gap.duration_ms += pending.reduce((sum, entry) => sum + entry.span.duration_ms, NONE)
	gap.ended_ms = last.span.ended_ms
}

// **Opening a round trip is what starts a stretch, and a later call of the same turn extends it**;
// everything else drops the pending time. The last branch is not only the human wait it was written
// for: a continuation — the tail of a call whose middle went to a delegated unit — opens no round trip
// and belongs to no turn still issuing calls, so carrying pending across it would charge the
// subagent's closing answer to the *parent's* next trip. A session seam does the same, since
// `time_corpus` concatenates one session's spans after another's with nothing in between.
function close_or_extend(walk: GapWalk, entry: Indexed, is_opener: boolean): void {
	if (is_opener) {
		walk.open = to_gap(walk.pending, entry)
		walk.gaps.push(walk.open)

		return
	}

	if (time_round_trips.is_call(entry.span)) absorb(walk.open, walk.pending)
	else walk.open = undefined
}

// A turn's model time is charged to a round trip only when that turn went on to open one. **The run's
// whole model wait is a different quantity**: a turn that called no tool — the answer that ends a
// reply, the turn that stops to wait for a person — composed nothing a batching change could remove,
// and folding it in prices every round trip above what cutting one actually returns.
function step_gap(walk: GapWalk, entry: Indexed, is_opener: boolean): void {
	if (time_round_trips.is_model(entry.span)) {
		walk.pending.push(entry)

		return
	}

	close_or_extend(walk, entry, is_opener)
	walk.pending = []
}

// **One stretch per round trip, in run order** (joshuafolkken/kit#1386). `group_round_trips` pushes a
// group on exactly the openers this pushes a gap on, so the two lists are the same length by
// construction rather than by assumption.
function issuing_model_gaps(spans: ReadonlyArray<Span>): Array<ModelGap> {
	const ordered = time_round_trips.in_time_order(spans)
	const walk: GapWalk = { pending: [], gaps: [], open: undefined }

	// A loop rather than `reduce`, which this project's lint config forbids — `group_round_trips`
	// drains its spans the same way.
	for (const [index, span] of ordered.entries()) {
		step_gap(walk, { index, span }, time_round_trips.opens_round_trip(ordered, index))
	}

	return walk.gaps
}

// The model time that actually issued the round trips — the numerator of the price the report
// prints, and the share of it a batching change removes (joshuafolkken/kit#1307).
//
// **Defined as the sum of the stretches above rather than folded separately** (joshuafolkken/kit#1386).
// The mean and the distribution are then two readings of one walk, so the report cannot come to print
// a mean the spread it sits beside could not produce.
function issuing_model_ms(spans: ReadonlyArray<Span>): number {
	return issuing_model_gaps(spans).reduce((sum, gap) => sum + gap.duration_ms, NONE)
}

const time_model_gaps = { issuing_model_gaps, issuing_model_ms }

export type { ModelGap }
export { time_model_gaps }
