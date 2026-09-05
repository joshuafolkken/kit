import { time_format } from './time-format'
import { time_round_trips } from './time-round-trips'
import { time_spans } from './time-spans'

// The round-trip block, as it is printed (joshuafolkken/kit#1304, joshuafolkken/kit#1307,
// joshuafolkken/kit#1385).
//
// It was `time-report.ts`'s until that file passed its length limit — the same seam `time-bundles.ts`
// and `time-failures.ts` were cut along, and the shape both of them already have: a block owns its own
// rendering, and `time-report.ts` calls one function per block. What stayed behind is the aggregation,
// which is what every other caller of that file reads.
//
// **It takes the figures rather than the report.** `time-report.ts` imports this module, so a type
// imported back from it would be a cycle — the same reason `time-bundles.ts` declares `TripPrice`
// locally instead of reaching for `TimeReport`.

const { format_columns, format_seconds, unmeasured_row, MODEL_LABEL, NO_CALLS } = time_format
const HEADING = 'Round trips:'
const CALLS_LABEL = 'tool calls'
const TRIPS_LABEL = 'round trips'
// How the turns that issued a call divided between the two shapes (joshuafolkken/kit#1385). One row
// rather than two, because the pair is read as a ratio — 7 batched against 94 single-call on run
// #1379 — and a reader comparing two runs wants both numbers on the same line.
const BATCHED_TURNS_LABEL = 'batched turns'
// What one of those trips cost. The label says `cost` rather than `elapsed` because the row is read
// as a unit price — the thing a proposed cut is multiplied by (joshuafolkken/kit#1307).
const COST_LABEL = 'cost per round trip'
// The unit the density and its floor are both quoted in, written once so the row and the warning
// beneath it cannot come to name it differently.
const PER_ROUND_TRIP = 'calls per round trip'
// The one sentence the threshold exists to produce. It names what is not happening rather than the
// number, because the number is already in the row above it.
const BATCHING_WARNING = 'independent calls are going out one per turn'
const NO_DENSITY = 0

// What the block reads off the report, and nothing else.
interface TripFacts {
	span_count: number
	turn_count: number
	tool_call_count: number
	round_trip_count: number
	batched_turn_count: number
	single_call_turn_count: number
	ms_per_round_trip: number
	model_ms_per_round_trip: number
}

// The threshold's whole output. Printed only when the density is under the floor, because a run that
// batches has nothing to say here and a line that appears every time is one nobody reads.
function batching_warning_lines(density: number): Array<string> {
	if (!time_round_trips.is_below_floor(density)) return []

	const floor = time_round_trips.format_density(time_round_trips.CALLS_PER_ROUND_TRIP_FLOOR)

	return [`  ⚠ ${BATCHING_WARNING} (floor ${floor} ${PER_ROUND_TRIP})`]
}

// **A transcript that was read but called no tool has no density, and says so.** The division
// answers `0` there, which is the same value an unread transcript produces — printing it as
// `0.00 calls per round trip` would report the worst possible batching for a scope that did no
// batching to grade.
function density_text(density: number): string {
	if (density === NO_DENSITY) return NO_CALLS

	return `${time_round_trips.format_density(density)} ${PER_ROUND_TRIP}`
}

// **A count nobody priced cannot be ranked** (joshuafolkken/kit#1307). Forty round trips is a
// number; forty at twelve seconds each is eight minutes, which is what a proposed cut is weighed
// against the slowest command with. The model share rides in the suffix because it is the part
// batching actually removes — a tool's own execution is paid whichever turn it is issued from.
//
// **Withheld on the density, not on a second test of its own.** A density of zero means there was no
// round trip to divide by, so the unit price has nothing behind it either — deciding that twice would
// let the two rows come to disagree about what was measured.
function cost_line(facts: TripFacts, density: number): string {
	if (density === NO_DENSITY) return format_columns(COST_LABEL, '', NO_CALLS)

	const model_cost = `${MODEL_LABEL} ${format_seconds(facts.model_ms_per_round_trip)}`

	return format_columns(COST_LABEL, format_seconds(facts.ms_per_round_trip), model_cost)
}

// **The two shapes of turn, on one line** (joshuafolkken/kit#1385). The density one row above says a
// run is not batching without saying over how much of the run — and unlike the density it is not
// withheld on a divisor of its own, because both counts are measured rather than divided: a run that
// issued no call at all has `0` batched and `0` single-call turns, which is what it did.
function batched_turns_line(facts: TripFacts): string {
	const single = `${String(facts.single_call_turn_count)} single-call turn(s)`

	return format_columns(BATCHED_TURNS_LABEL, String(facts.batched_turn_count), single)
}

function measured_lines(facts: TripFacts): Array<string> {
	const { tool_call_count, round_trip_count, turn_count } = facts
	const density = time_round_trips.per_round_trip(tool_call_count, round_trip_count)

	return [
		format_columns(CALLS_LABEL, String(tool_call_count), `over ${String(turn_count)} turn(s)`),
		format_columns(TRIPS_LABEL, String(round_trip_count), density_text(density)),
		batched_turns_line(facts),
		cost_line(facts, density),
		...batching_warning_lines(density),
	]
}

const LABELS = [CALLS_LABEL, TRIPS_LABEL, BATCHED_TURNS_LABEL, COST_LABEL]

// **A run whose transcript was not read has no round trips to report, and says so** — the same
// answer, on the same criterion, that the three category shares already give. A count of `0` here
// would read as a run that called no tool at all, which is never true of a run that merged.
function trip_lines(facts: TripFacts): Array<string> {
	const heading = ['', HEADING]

	if (!time_spans.has_transcript_data(facts.span_count)) {
		return [...heading, ...LABELS.map((label) => unmeasured_row(label))]
	}

	return [...heading, ...measured_lines(facts)]
}

const time_trips = {
	HEADING,
	CALLS_LABEL,
	TRIPS_LABEL,
	BATCHED_TURNS_LABEL,
	COST_LABEL,
	PER_ROUND_TRIP,
	BATCHING_WARNING,
	trip_lines,
}

export type { TripFacts }
export { time_trips }
