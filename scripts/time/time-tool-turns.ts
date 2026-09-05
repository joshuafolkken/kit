import { time_round_trips } from './time-round-trips'
import type { Span } from './time-spans'

// Which tool a run's round trips actually belong to (joshuafolkken/kit#1385).
//
// The round-trip block reports one density for the whole run — 108 calls over 101 round trips on run
// #1379, 1.07 — and a density says a run is not batching without saying **what** it failed to batch.
// Measuring the same run through this module finds the answer sitting one column away: of its 101
// round trips only 7 issued several tools at once, and every one of its 39 `Edit` calls went out
// alone, splitting the change into a turn of about six lines each. joshuafolkken/kit#1344 sized what
// batching would return and still could not name the tool to batch, which is part of why the warning
// moved the number across none of three consecutive runs: it says "this is low", never "bundle the
// edits".
//
// So each per-tool row carries two counts beside its duration and its call count — the round trips
// that tool consumed, and how many of its calls were the only call in their turn — and the report
// carries the same split for the run as a whole.
//
// **The grouping is `time-round-trips.ts`'s, not a second one.** `group_round_trips` returns the very
// groups that module counts, so a row's round trips and the run's total are the same arithmetic read
// at two grains; a walk of its own here would be the clone `CLAUDE.md` prohibits, in the one place a
// drift would make a report disagree with itself about what a round trip is.

const ONE_CALL = 1

// What one tool's calls cost in turns. **`alone_in_turn_count` is not `call_count - something`**: a
// tool called twice in one turn contributes one round trip and no alone-calls, and the two counts are
// read off the groups rather than derived from each other.
interface ToolTurnCounts {
	round_trip_count: number
	alone_in_turn_count: number
}

// How the run's turns divided between the two shapes. They sum to `round_trip_count`, since every
// counted round trip issued either one call or more than one — a turn that called nothing is neither,
// and is already outside what a round trip is.
interface TurnSplit {
	batched_turn_count: number
	single_call_turn_count: number
}

const NO_TURN_SPLIT: TurnSplit = { batched_turn_count: 0, single_call_turn_count: 0 }

interface TurnTotals {
	by_label: Map<string, ToolTurnCounts>
	split: TurnSplit
}

function no_counts(): ToolTurnCounts {
	return { round_trip_count: 0, alone_in_turn_count: 0 }
}

// The labels one round trip issued a call for, each counted once however many calls of it went out.
// A tool called twice in one turn consumed **one** round trip, not two — counting it twice would make
// the column sum past the run's own round-trip count.
function labels_of(trip: ReadonlyArray<Span>): Set<string> {
	return new Set(trip.map((span) => span.label).filter((label) => label !== ''))
}

function add_trip(by_label: Map<string, ToolTurnCounts>, label: string, is_alone: boolean): void {
	const counts = by_label.get(label) ?? no_counts()

	by_label.set(label, {
		round_trip_count: counts.round_trip_count + 1,
		alone_in_turn_count: counts.alone_in_turn_count + (is_alone ? 1 : 0),
	})
}

function count_trip(by_label: Map<string, ToolTurnCounts>, trip: ReadonlyArray<Span>): void {
	const is_alone = trip.length === ONE_CALL

	for (const label of labels_of(trip)) add_trip(by_label, label, is_alone)
}

function split_of(trips: ReadonlyArray<ReadonlyArray<Span>>): TurnSplit {
	return {
		batched_turn_count: trips.filter((trip) => trip.length > ONE_CALL).length,
		single_call_turn_count: trips.filter((trip) => trip.length === ONE_CALL).length,
	}
}

// **The groups are taken exactly as they come, unfiltered.** Every group holds at least the call that
// opened it, so there is nothing to drop — and a filter here would be the one way the two halves of
// the split could come to total less than `round_trip_count`, which is the sum the printed row tells a
// reader to cross-check it against. A quietly short total is worse than a failure.
function build_turns(spans: ReadonlyArray<Span>): TurnTotals {
	const trips = time_round_trips.group_round_trips(spans)
	const by_label = new Map<string, ToolTurnCounts>()

	// A loop rather than `reduce`, which this project's lint config forbids — `time-report.ts` drains
	// its per-label map the same way.
	for (const trip of trips) count_trip(by_label, trip)

	return { by_label, split: split_of(trips) }
}

// The one field a row has to carry to be merged, so this module never imports a row type from
// `time-report.ts` — which imports this one.
interface LabelRow {
	label: string
}

// **A label with no counts is a measured zero, not a withheld one** — the withholding this report does
// happens one level up, on whether any span was read at all.
//
// **A row can carry calls and no round trip, and that is the honest reading.** A call sitting in a run
// of adjacent tool spans that a continuation heads opens no round trip, so it is counted as a call and
// charged to no trip — `1 call(s) · 0 round trip(s) · 0 alone`. It is the same divergence
// `tool_call_count` and `round_trip_count` already have at the run scale, and inventing a trip for it
// here would report one the run never made.
function with_turn_counts<Row extends LabelRow>(
	rows: ReadonlyArray<Row>,
	by_label: ReadonlyMap<string, ToolTurnCounts>,
): Array<Row & ToolTurnCounts> {
	return rows.map((row) => ({ ...row, ...(by_label.get(row.label) ?? no_counts()) }))
}

// **Nothing here decides whether the split was measured.** The round-trip block already withholds its
// whole set of rows on `time_spans.has_transcript_data`, and the two new rows are inside it — a second
// test here would be a second thing to keep in step with the first.
const time_tool_turns = {
	NO_TURN_SPLIT,
	build_turns,
	with_turn_counts,
}

export type { ToolTurnCounts, TurnSplit, TurnTotals }
export { time_tool_turns }
