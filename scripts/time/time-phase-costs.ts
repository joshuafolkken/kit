import { time_format } from './time-format'
import type { PhaseName } from './time-phase-names'
import { time_phases } from './time-phases'
import {
	time_region_costs,
	type Bucket,
	type LabeledRegion,
	type PricedRequest,
} from './time-region-costs'
import { time_round_trips } from './time-round-trips'
import type { Span } from './time-spans'

// What each stage of a run cost, and what one round trip cost (joshuafolkken/kit#1606).
//
// **`josh time` knew the phases and not the money; `josh cost` knew the money and not the phases.**
// There was no place the two met, so "which stage spent what" was a question nobody could answer —
// and the diag skill's ranked table said so in prose, ranking every proposal on wall clock.
//
// **The phase a request belongs to is decided by `time_phases.classify`, never re-derived here.**
// This module turns those spans into intervals; the walk that places a request inside one, the
// arithmetic that adds it, and the rows it prints are `time-region-costs.ts`'s, shared with the
// per-contributor cost block so the two cannot come to disagree about what a dollar bought
// (joshuafolkken/kit#1872).
//
// **A request inside no interval goes to a bucket of its own and is never prorated** — reported as
// unattributed and kept out of every ranking, rather than spread across phases that were not running.
//
// **The dollar figure per round trip uses `ms_per_round_trip`'s own denominator**, so the two can be
// multiplied by the same recoverable-trip count. The block prints both the request count and the
// round-trip count side by side, because a run has more requests than round trips: every assistant
// message is billed whether or not it issued a call.

interface PhaseCost extends Bucket {
	phase: PhaseName
}

// **`is_measured: false` is not "this run spent nothing".** The batch scopes and the history
// recorder do not read the cost corpus at all, so their reports carry this record with every figure
// at zero and the flag off; a reader that took those zeros for a measurement would rank a phase as
// free.
interface PhaseCostFacts {
	by_phase: ReadonlyArray<PhaseCost>
	unattributed: Bucket
	request_count: number
	cost_usd: number
	round_trip_count: number
	usd_per_round_trip: number
	// How many of the requests above the price table could not cost. Non-zero makes `cost_usd` a
	// floor rather than the run's cost, and the block says so in words.
	unpriced_request_count: number
	is_measured: boolean
}

interface PhaseCostInput {
	spans: ReadonlyArray<Span>
	// `undefined` means nothing was read, which is not the same as an empty read.
	requests: ReadonlyArray<PricedRequest> | undefined
	round_trip_count: number
}

// One span's stretch of wall clock, labelled with the phase the classifier put it in.
function regions_of(spans: ReadonlyArray<Span>): Array<LabeledRegion> {
	const names = time_phases.classify(spans)

	return spans.map((span, index) => ({
		start_ms: span.ended_ms - span.duration_ms,
		end_ms: span.ended_ms,
		// `classify` maps the same array, so this index always has a name; the fallback is what
		// `noUncheckedIndexedAccess` requires of the read rather than a guard against a real state.
		label: names[index] ?? time_phases.OTHER_PHASE,
	}))
}

// Run order, so the rows line up with the phase table above them. A phase no request landed in is
// left out rather than printed as zero: the two tables answer different questions, and a phase can
// legitimately have minutes with no request of its own inside them.
function rows_of(by_label: ReadonlyMap<string, Bucket>): Array<PhaseCost> {
	return time_phases.PHASE_ORDER.filter((phase) => by_label.has(phase)).map((phase) => ({
		phase,
		...(by_label.get(phase) ?? time_region_costs.EMPTY_BUCKET),
	}))
}

function unmeasured(round_trip_count: number): PhaseCostFacts {
	return {
		by_phase: [],
		unattributed: time_region_costs.EMPTY_BUCKET,
		request_count: time_region_costs.NONE,
		cost_usd: time_region_costs.NO_COST,
		round_trip_count,
		usd_per_round_trip: time_region_costs.NO_COST,
		unpriced_request_count: time_region_costs.NONE,
		is_measured: false,
	}
}

function build(input: PhaseCostInput): PhaseCostFacts {
	const { requests, spans, round_trip_count } = input

	if (requests === undefined) return unmeasured(round_trip_count)

	const counted = time_region_costs.tally(regions_of(spans), requests)
	const by_phase = rows_of(counted.by_label)
	const total = time_region_costs.sum_of([...by_phase, counted.unattributed])

	return {
		by_phase,
		unattributed: counted.unattributed,
		...total,
		round_trip_count,
		usd_per_round_trip: time_round_trips.per_round_trip(total.cost_usd, round_trip_count),
		unpriced_request_count: time_region_costs.unpriced_count(requests),
		is_measured: true,
	}
}

const HEADING = 'What it cost, by phase:'
const UNATTRIBUTED_LABEL = 'unattributed'
const UNATTRIBUTED_NOTE = 'inside no phase window · never prorated'

function unattributed_lines(facts: PhaseCostFacts): Array<string> {
	const { unattributed } = facts

	if (unattributed.request_count === time_region_costs.NONE) return []

	return [
		time_region_costs.leftover_line(
			UNATTRIBUTED_LABEL,
			unattributed,
			facts.cost_usd,
			UNATTRIBUTED_NOTE,
		),
	]
}

function measured_lines(facts: PhaseCostFacts): Array<string> {
	return [
		...facts.by_phase.map((row) => time_region_costs.bucket_line(row.phase, row, facts.cost_usd)),
		...unattributed_lines(facts),
		time_region_costs.total_line(facts.cost_usd, facts.request_count, facts.round_trip_count),
		time_region_costs.per_trip_line(facts.usd_per_round_trip),
		...time_region_costs.unpriced_lines(facts.unpriced_request_count),
	]
}

// Nothing at all where the scope never carried the record, so the session, epic and period reports
// print exactly what they printed before. A scope that asked and found no priced request still
// prints the block, saying so in words.
function cost_lines(facts: PhaseCostFacts | undefined): Array<string> {
	if (facts === undefined) return []

	if (!facts.is_measured) {
		return [
			'',
			HEADING,
			time_format.format_columns(
				time_region_costs.TOTAL_LABEL,
				'',
				time_region_costs.NOT_MEASURED_NOTE,
			),
		]
	}

	return ['', HEADING, ...measured_lines(facts)]
}

const time_phase_costs = {
	HEADING,
	UNATTRIBUTED_LABEL,
	UNATTRIBUTED_NOTE,
	TOTAL_LABEL: time_region_costs.TOTAL_LABEL,
	PER_TRIP_LABEL: time_region_costs.PER_TRIP_LABEL,
	DENOMINATOR_NOTE: time_region_costs.DENOMINATOR_NOTE,
	NOT_MEASURED_NOTE: time_region_costs.NOT_MEASURED_NOTE,
	UNPRICED_LABEL: time_region_costs.UNPRICED_LABEL,
	UNPRICED_NOTE: time_region_costs.UNPRICED_NOTE,
	build,
	cost_lines,
}

export type { PhaseCost, PhaseCostFacts, PhaseCostInput }
export { time_phase_costs }

export { type PricedRequest } from './time-region-costs'
