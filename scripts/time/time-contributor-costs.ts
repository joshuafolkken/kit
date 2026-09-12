import { time_format } from './time-format'
import { time_parent_turns } from './time-parent-turns'
import {
	time_region_costs,
	type Bucket,
	type LabeledRegion,
	type PricedRequest,
} from './time-region-costs'
import { time_round_trips } from './time-round-trips'
import type { Span } from './time-spans'

// What a run's turns cost, grouped by what they were for (joshuafolkken/kit#1872).
//
// **`Turns by contributor:` said how many turns each purpose took and never what they cost.** The
// cost question turns on that pairing: a purpose with few turns can dominate the bill if its turns
// fall late, when the carried conversation makes each one dear, and a purpose with many can be
// cheap. Neither `contributors` (turns, no money) nor `phase_costs` (money, but keyed by stage)
// could say it — so "which purpose spent what" was a question no report answered.
//
// **The purpose a turn belongs to is `time_parent_turns.contributor_of_trip`, never re-derived here.**
// The count block labels a round trip by that same rule, so the two tables cannot come to disagree
// about what a turn was for. The attribution that places a billed request inside a turn's stretch of
// wall clock, the arithmetic that adds it, and the rows it prints are `time-region-costs.ts`'s,
// shared with `phase_costs`.
//
// **A billed request inside no round trip is a turn that issued no tool.** Every assistant message is
// billed whether or not it called anything, so a run has more requests than round trips; the ones
// that land in no tool-issuing turn's window are the utterance-only turns, which `group_round_trips`
// drops entirely. They go to a bucket of their own — counted, never prorated across the purposes that
// did call something — because the count of them is exactly the reading this block was asked to add.

interface ContributorCost extends Bucket {
	contributor: string
}

// **`is_measured: false` is not "this run's turns were free".** The batch scopes and the history
// recorder never read the cost corpus, so their reports carry this record at zero with the flag off;
// a reader that took those zeros for a measurement would rank a purpose as costless.
interface ContributorCostFacts {
	by_contributor: ReadonlyArray<ContributorCost>
	// Billed turns that issued no tool — counted independently, so a run whose spend is mostly
	// tool-less deliberation reads as that rather than as a gap in the purposes.
	no_tool_call: Bucket
	request_count: number
	cost_usd: number
	round_trip_count: number
	usd_per_round_trip: number
	unpriced_request_count: number
	is_measured: boolean
}

// Spans and the priced requests to place against them. `requests: undefined` means the cost corpus
// was not read, which the batch scopes never do — kept apart from an empty read of it.
interface ContributorCostInput {
	spans: ReadonlyArray<Span>
	requests: ReadonlyArray<PricedRequest> | undefined
	round_trip_count: number
}

// One round trip's stretch of wall clock: from the earliest instant one of its calls began to the
// latest one ended, labelled by the purpose the trip served. A turn's own billed request sits on the
// opening instant — the model wait that produced the call ends exactly where the call starts.
function region_of(trip: ReadonlyArray<Span>): LabeledRegion {
	return {
		start_ms: Math.min(...trip.map((span) => span.ended_ms - span.duration_ms)),
		end_ms: Math.max(...trip.map((span) => span.ended_ms)),
		label: time_parent_turns.contributor_of_trip(trip),
	}
}

function regions_of(spans: ReadonlyArray<Span>): Array<LabeledRegion> {
	return time_round_trips.group_round_trips(spans).map((trip) => region_of(trip))
}

// In the contributor precedence order, the same rows the count block prints, so a reader comparing
// the two finds them lined up. A purpose no request landed in is left out rather than printed at zero.
function rows_of(by_label: ReadonlyMap<string, Bucket>): Array<ContributorCost> {
	return time_parent_turns.CONTRIBUTOR_NAMES.filter((contributor) => by_label.has(contributor)).map(
		(contributor) => ({
			contributor,
			...(by_label.get(contributor) ?? time_region_costs.EMPTY_BUCKET),
		}),
	)
}

function unmeasured(round_trip_count: number): ContributorCostFacts {
	return {
		by_contributor: [],
		no_tool_call: time_region_costs.EMPTY_BUCKET,
		request_count: time_region_costs.NONE,
		cost_usd: time_region_costs.NO_COST,
		round_trip_count,
		usd_per_round_trip: time_region_costs.NO_COST,
		unpriced_request_count: time_region_costs.NONE,
		is_measured: false,
	}
}

function build(input: ContributorCostInput): ContributorCostFacts {
	const { requests, spans, round_trip_count } = input

	if (requests === undefined) return unmeasured(round_trip_count)

	const counted = time_region_costs.tally(regions_of(spans), requests)
	const by_contributor = rows_of(counted.by_label)
	const total = time_region_costs.sum_of([...by_contributor, counted.unattributed])

	return {
		by_contributor,
		no_tool_call: counted.unattributed,
		...total,
		round_trip_count,
		usd_per_round_trip: time_round_trips.per_round_trip(total.cost_usd, round_trip_count),
		unpriced_request_count: time_region_costs.unpriced_count(requests),
		is_measured: true,
	}
}

const HEADING = 'What it cost, by contributor:'
const NO_TOOL_CALL_LABEL = 'no tool call'
const NO_TOOL_CALL_NOTE = 'turns that issued no tool · counted, never prorated'

function no_tool_call_lines(facts: ContributorCostFacts): Array<string> {
	const { no_tool_call } = facts

	if (no_tool_call.request_count === time_region_costs.NONE) return []

	return [
		time_region_costs.leftover_line(
			NO_TOOL_CALL_LABEL,
			no_tool_call,
			facts.cost_usd,
			NO_TOOL_CALL_NOTE,
		),
	]
}

function measured_lines(facts: ContributorCostFacts): Array<string> {
	return [
		...facts.by_contributor.map((row) =>
			time_region_costs.bucket_line(row.contributor, row, facts.cost_usd),
		),
		...no_tool_call_lines(facts),
		time_region_costs.total_line(facts.cost_usd, facts.request_count, facts.round_trip_count),
		time_region_costs.per_trip_line(facts.usd_per_round_trip),
		...time_region_costs.unpriced_lines(facts.unpriced_request_count),
	]
}

// Nothing at all where the scope never carried the record, so the batch and period reports print
// exactly what they printed before. A scope that asked and found no priced request still prints the
// block, saying so in words.
function cost_lines(facts: ContributorCostFacts | undefined): Array<string> {
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

const time_contributor_costs = {
	HEADING,
	NO_TOOL_CALL_LABEL,
	NO_TOOL_CALL_NOTE,
	build,
	cost_lines,
}

export type { ContributorCost, ContributorCostFacts, ContributorCostInput }
export { time_contributor_costs }
