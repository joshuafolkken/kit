import { time_distribution, type Distribution } from './time-distribution'
import { time_format } from './time-format'
import { time_phases, type PhaseName } from './time-phases'
import { time_round_trips, type ModelGap } from './time-round-trips'
import { time_spans, type Span } from './time-spans'

// The model wait a run spends per round trip, read as a distribution rather than as a mean
// (joshuafolkken/kit#1386).
//
// The round-trip block prices a trip at `model wait 8.1 s`, and the 2026-09-05 hand measurement of
// run #1379 found the same run's stretches were 3.8 s at the median, 17.1 s at p90 and **189 s at the
// worst** — one uninterrupted stretch in the exploration phase, 12% of a 1,633-second run, and
// arithmetically invisible in that 8.1. A mean cannot say whether a run is slow everywhere or slow
// once, and those two runs need opposite fixes: batching removes many small trips, and nothing about
// batching touches one long think.
//
// **It is the mean's distribution, not a second measurement.** The stretches come from
// `time_round_trips.issuing_model_gaps`, which is what `issuing_model_ms` now sums — so the median
// here and the price one block above are two readings of one walk, and a scope the price is withheld
// for is a scope this is withheld for on the same criterion.
//
// **The distribution shape is `--last`'s.** `time-distribution.ts` already answers min / median / p90
// / max and already withholds an empty sample rather than zeroing it; a percentile helper written
// beside this block would be the clone `CLAUDE.md` prohibits.

const { format_columns, format_seconds, format_share, format_window, unmeasured_row } = time_format
const { SUFFIX_SEPARATOR, NO_CALLS } = time_format
const HEADING = 'Model gap per round trip:'
const LONGEST_HEADING = 'Longest model gaps (descending):'
const GAP_LABEL = 'model gap'
const ELAPSED_SUFFIX = 'of elapsed'
// How many of the longest stretches are printed. **Ranked by length rather than left in run order**,
// which is the treatment the segment table already gets: a reader asking which stretch to attack
// wants the top of the list, and a run has as many stretches as it has round trips. Five rather than
// the 15 the row tables cap at, because one long stretch is the finding and a table of fifteen buries
// it under the ordinary ones.
const MAX_LONGEST = 5
const NONE = 0

// One of the longest stretches, with the phase it began in. The phase is the whole point of the row:
// a long stretch during exploration is a run thinking before it acts, and the same stretch during
// rework is a run stuck.
interface LongestGap {
	duration_ms: number
	started_ms: number
	ended_ms: number
	phase: PhaseName
}

// What the walk established. **`is_measured` is not `sample_count > 0`**: a transcript nobody read and
// a transcript that made no round trip are different answers, and only the first is `not measured` —
// the same two withheld cases, in the same words, `time-bundles.ts` already prints.
interface GapTotals {
	distribution: Distribution
	longest: Array<LongestGap>
	is_measured: boolean
}

const NO_GAPS: GapTotals = {
	distribution: time_distribution.NOTHING_MEASURED,
	longest: [],
	is_measured: false,
}

function to_longest(gap: ModelGap, phases: ReadonlyArray<PhaseName>): LongestGap {
	return {
		duration_ms: gap.duration_ms,
		started_ms: gap.started_ms,
		ended_ms: gap.ended_ms,
		phase: phases[gap.span_index] ?? time_phases.OTHER_PHASE,
	}
}

function build_gaps(spans: ReadonlyArray<Span>): GapTotals {
	const ordered = time_round_trips.in_time_order(spans)
	const phases = time_phases.classify(ordered)
	const gaps = time_round_trips.issuing_model_gaps(spans)
	const longest = gaps.toSorted((left, right) => right.duration_ms - left.duration_ms)

	return {
		distribution: time_distribution.build(gaps.map((gap) => gap.duration_ms)),
		longest: longest.slice(NONE, MAX_LONGEST).map((gap) => to_longest(gap, phases)),
		is_measured: time_spans.has_transcript_data(spans.length),
	}
}

// **The median goes in the numeric column and the spread in the suffix**, which is the convention
// `--last`'s own distribution table established: a reader scanning the column is scanning one
// comparable figure per row rather than four.
//
// **The two renderers pick different figures out of one record, on purpose.** `--last` prints the
// sample count because nothing else on that page says how many runs a row was read from; here the
// sample count *is* the round-trip count, printed one row above in the block this sits under, and
// repeating it would be a second answer to a question already answered. `--last` omits `p90` for the
// converse reason: a handful of runs has no separate ninetieth to print.
function distribution_line(distribution: Distribution): string {
	const spread = [
		`min ${format_seconds(distribution.min_ms)}`,
		`p90 ${format_seconds(distribution.p90_ms)}`,
		`max ${format_seconds(distribution.max_ms)}`,
	].join(SUFFIX_SEPARATOR)

	return format_columns(GAP_LABEL, format_seconds(distribution.median_ms), spread)
}

// **The share is what makes one stretch worth reading about.** 189 seconds is a number; 12% of the run
// is the reason it outranks every command in the table below it.
function longest_line(gap: LongestGap, elapsed_ms: number): string {
	const share = `${format_share(gap.duration_ms, elapsed_ms)} ${ELAPSED_SUFFIX}`
	const suffix = `${gap.phase}${SUFFIX_SEPARATOR}${share}`

	return format_columns(
		format_window(gap.started_ms, gap.ended_ms),
		format_seconds(gap.duration_ms),
		suffix,
	)
}

function longest_lines(totals: GapTotals, elapsed_ms: number): Array<string> {
	if (totals.longest.length === NONE) return []

	return ['', LONGEST_HEADING, ...totals.longest.map((gap) => longest_line(gap, elapsed_ms))]
}

// **Both withheld cases print, and they say different things.** A `span_count` of zero is a transcript
// nobody read, so the row is `not measured`; a transcript read that made no round trip has no stretch
// to distribute, so it says what the price row one block above says. Neither is a zero — a `0.0 s`
// median would report the fastest possible run for a scope nobody measured.
function gap_lines(totals: GapTotals, elapsed_ms: number): Array<string> {
	const heading = ['', HEADING]

	if (!totals.is_measured) return [...heading, unmeasured_row(GAP_LABEL)]

	if (!time_distribution.is_measured(totals.distribution)) {
		return [...heading, format_columns(GAP_LABEL, '', NO_CALLS)]
	}

	return [...heading, distribution_line(totals.distribution), ...longest_lines(totals, elapsed_ms)]
}

const time_gaps = {
	HEADING,
	LONGEST_HEADING,
	GAP_LABEL,
	MAX_LONGEST,
	NO_GAPS,
	build_gaps,
	gap_lines,
}

export type { GapTotals }
export { time_gaps }
