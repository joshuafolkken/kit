import { time_format } from './time-format'
import type { PhaseName } from './time-phase-names'
import { time_phases } from './time-phases'
import { time_round_trips } from './time-round-trips'
import type { Span } from './time-spans'

// What each stage of a run cost, and what one round trip cost (joshuafolkken/kit#1606).
//
// **`josh time` knew the phases and not the money; `josh cost` knew the money and not the phases.**
// There was no place the two met, so "which stage spent what" was a question nobody could answer —
// and the diag skill's ranked table said so in prose, ranking every proposal on wall clock because
// the dollar column could only ever have been a share of the run total, which is the arithmetic that
// file already forbids.
//
// **The phase a request belongs to is decided by `time_phases.classify`, never re-derived here.**
// The classifier already answers, span by span, which phase a moment of the run was in; this module
// turns those spans into intervals and asks which one contains the request's own instant. A second
// implementation of the boundaries would come to disagree with the phase table printed six lines
// above it, and a reader would have no way to tell which of the two was wrong.
//
// **A request inside no interval goes to a bucket of its own and is never prorated.** Spreading it
// across the phases in proportion would put money into stages that demonstrably were not running,
// which is the same manufactured confidence `wait-outside` and `pre-run` were split out to stop: a
// number that cannot be attributed is reported as unattributed, and stays out of every ranking.
//
// **The dollar figure per round trip uses `ms_per_round_trip`'s own denominator**, so the two can be
// multiplied by the same recoverable-trip count. What differs is the *numerator's* unit of work:
// minutes are measured over the spans a turn issued, while dollars are measured over billed
// requests, and a run has more requests than round trips because every assistant message is billed
// whether or not it issued a call. The block prints both counts side by side rather than leaving
// that to be discovered.

const NONE = 0
const NO_COST = 0
const ONE_REQUEST = 1
const TOTAL_DECIMALS = 2
const TRIP_DECIMALS = 3

// A priced request, reduced to the two things attribution needs. `at_ms` is `undefined` where the
// transcript line carried no readable timestamp — such a request is priced but cannot be placed in
// any phase, and dropping it would quietly shrink the run's total.
interface PricedRequest {
	at_ms: number | undefined
	cost_usd: number
	// Whether the price table could cost this request's model at all. An unpriced one contributes a
	// request and no dollars, so without this flag a run on a model nobody has priced yet would print
	// every phase at `$0.00` and read as a run that was free — the confident zero this whole module is
	// written against. It rides on the request rather than being counted by the reader, because only
	// the reader knows which model each one was sent to.
	is_priced: boolean
}

// What one row of the table holds, before it is told which phase it belongs to. The unattributed
// row is the same record with no phase to name, which is why the two share one shape.
interface Bucket {
	request_count: number
	cost_usd: number
}

interface PhaseCost extends Bucket {
	phase: PhaseName
}

// **`is_measured: false` is not "this run spent nothing".** The batch scopes and the history
// recorder do not read the cost corpus at all, so their reports carry this record with every figure
// at zero and the flag off; a reader that took those zeros for a measurement would rank a phase as
// free. Same distinction the phase table's `is_detected` makes.
interface PhaseCostFacts {
	by_phase: ReadonlyArray<PhaseCost>
	unattributed: Bucket
	request_count: number
	cost_usd: number
	round_trip_count: number
	usd_per_round_trip: number
	// How many of the requests above the price table could not cost. Non-zero makes `cost_usd` a
	// floor rather than the run's cost, and the block says so in words — the same reading
	// `josh cost`'s `unpriced_models` gets, stated here because this block is printed on its own.
	unpriced_request_count: number
	is_measured: boolean
}

interface PhaseCostInput {
	spans: ReadonlyArray<Span>
	// `undefined` means nothing was read, which is not the same as an empty read.
	requests: ReadonlyArray<PricedRequest> | undefined
	round_trip_count: number
}

// One span's stretch of wall clock, carrying the phase the classifier put it in.
interface Region {
	start_ms: number
	end_ms: number
	phase: PhaseName
}

const EMPTY_BUCKET: Bucket = { request_count: NONE, cost_usd: NO_COST }

function regions_of(spans: ReadonlyArray<Span>): Array<Region> {
	const names = time_phases.classify(spans)

	return spans
		.map((span, index) => ({
			start_ms: span.ended_ms - span.duration_ms,
			end_ms: span.ended_ms,
			// `classify` maps the same array, so this index always has a name; the fallback is what
			// `noUncheckedIndexedAccess` requires of the read rather than a guard against a real state.
			phase: names[index] ?? time_phases.OTHER_PHASE,
		}))
		.toSorted((left, right) => left.end_ms - right.end_ms)
}

// The narrowest interval containing the instant — the first match, since `regions_of` sorted them by
// where they end.
//
// **Both ends are closed, and the boundary case is the normal one.** Every assistant line closes a
// model span, so a request's instant equals that span's `ended_ms` and equals the next span's start;
// two regions therefore contain it. The one that *ends* there is the model wait for this very
// request, which is why the narrower end wins — and why the choice is made by the sort rather than by
// array order, which a cross-session concatenation does not put in time order.
function phase_at(
	regions: ReadonlyArray<Region>,
	at_ms: number | undefined,
): PhaseName | undefined {
	if (at_ms === undefined) return undefined

	return regions.find((region) => at_ms >= region.start_ms && at_ms <= region.end_ms)?.phase
}

function added(bucket: Bucket, cost_usd: number): Bucket {
	return {
		request_count: bucket.request_count + ONE_REQUEST,
		cost_usd: bucket.cost_usd + cost_usd,
	}
}

interface Tally {
	by_phase: Map<PhaseName, Bucket>
	unattributed: Bucket
}

function tally(regions: ReadonlyArray<Region>, requests: ReadonlyArray<PricedRequest>): Tally {
	const by_phase = new Map<PhaseName, Bucket>()
	let unattributed = EMPTY_BUCKET

	for (const request of requests) {
		const phase = phase_at(regions, request.at_ms)

		if (phase === undefined) unattributed = added(unattributed, request.cost_usd)
		else by_phase.set(phase, added(by_phase.get(phase) ?? EMPTY_BUCKET, request.cost_usd))
	}

	return { by_phase, unattributed }
}

// Run order, so the rows line up with the phase table above them. A phase no request landed in is
// left out rather than printed as zero: the two tables answer different questions, and a phase can
// legitimately have minutes with no request of its own inside them.
function rows_of(counted: Tally): Array<PhaseCost> {
	return time_phases.PHASE_ORDER.filter((phase) => counted.by_phase.has(phase)).map((phase) => ({
		phase,
		...(counted.by_phase.get(phase) ?? EMPTY_BUCKET),
	}))
}

function sum_of(buckets: ReadonlyArray<Bucket>): Bucket {
	let total = EMPTY_BUCKET

	for (const bucket of buckets) {
		total = {
			request_count: total.request_count + bucket.request_count,
			cost_usd: total.cost_usd + bucket.cost_usd,
		}
	}

	return total
}

function unmeasured(round_trip_count: number): PhaseCostFacts {
	return {
		by_phase: [],
		unattributed: EMPTY_BUCKET,
		request_count: NONE,
		cost_usd: NO_COST,
		round_trip_count,
		usd_per_round_trip: NO_COST,
		unpriced_request_count: NONE,
		is_measured: false,
	}
}

function build(input: PhaseCostInput): PhaseCostFacts {
	const { requests, spans, round_trip_count } = input

	if (requests === undefined) return unmeasured(round_trip_count)

	const counted = tally(regions_of(spans), requests)
	const by_phase = rows_of(counted)
	const total = sum_of([...by_phase, counted.unattributed])

	return {
		by_phase,
		unattributed: counted.unattributed,
		...total,
		round_trip_count,
		usd_per_round_trip: time_round_trips.per_round_trip(total.cost_usd, round_trip_count),
		unpriced_request_count: requests.filter((request) => !request.is_priced).length,
		is_measured: true,
	}
}

const HEADING = 'What it cost, by phase:'
const UNATTRIBUTED_LABEL = 'unattributed'
const UNATTRIBUTED_NOTE = 'inside no phase window · never prorated'
const TOTAL_LABEL = 'priced total'
const PER_TRIP_LABEL = 'usd per round trip'
const DENOMINATOR_NOTE = 'same denominator as ms per round trip'
const NOT_MEASURED_NOTE = 'the cost corpus was not read for this scope'
const UNPRICED_LABEL = 'unpriced requests'
const UNPRICED_NOTE = 'on a model the price table does not carry · the total above is a floor'

function usd(amount: number, decimals: number): string {
	return `$${amount.toFixed(decimals)}`
}

function requests_text(count: number): string {
	return `${String(count)} request(s)`
}

function bucket_line(label: string, bucket: Bucket, facts: PhaseCostFacts): string {
	const share = time_format.format_share(bucket.cost_usd, facts.cost_usd)
	const suffix = [share, requests_text(bucket.request_count)].join(time_format.SUFFIX_SEPARATOR)

	return time_format.format_columns(label, usd(bucket.cost_usd, TOTAL_DECIMALS), suffix)
}

function unattributed_lines(facts: PhaseCostFacts): Array<string> {
	const { unattributed } = facts

	if (unattributed.request_count === NONE) return []

	const line = bucket_line(UNATTRIBUTED_LABEL, unattributed, facts)

	return [`${line}${time_format.SUFFIX_SEPARATOR}${UNATTRIBUTED_NOTE}`]
}

function total_line(facts: PhaseCostFacts): string {
	const trips = `over ${String(facts.round_trip_count)} round trip(s)`
	const suffix = [requests_text(facts.request_count), trips].join(time_format.SUFFIX_SEPARATOR)

	return time_format.format_columns(TOTAL_LABEL, usd(facts.cost_usd, TOTAL_DECIMALS), suffix)
}

function per_trip_line(facts: PhaseCostFacts): string {
	const amount = usd(facts.usd_per_round_trip, TRIP_DECIMALS)

	return time_format.format_columns(PER_TRIP_LABEL, amount, DENOMINATOR_NOTE)
}

// Printed only where there is something to say: a run whose every model was priced carries no such
// row, and a floor note over a complete reading would be as misleading as its absence over a partial
// one.
function unpriced_lines(facts: PhaseCostFacts): Array<string> {
	const { unpriced_request_count } = facts

	if (unpriced_request_count === NONE) return []

	const count = time_format.format_columns(UNPRICED_LABEL, String(unpriced_request_count), '')

	return [`${count.trimEnd()}${time_format.SUFFIX_SEPARATOR}${UNPRICED_NOTE}`]
}

function measured_lines(facts: PhaseCostFacts): Array<string> {
	return [
		...facts.by_phase.map((row) => bucket_line(row.phase, row, facts)),
		...unattributed_lines(facts),
		total_line(facts),
		per_trip_line(facts),
		...unpriced_lines(facts),
	]
}

// Nothing at all where the scope never carried the record, so the session, epic and period reports
// print exactly what they printed before. A scope that asked and found no priced request still
// prints the block, saying so in words.
function cost_lines(facts: PhaseCostFacts | undefined): Array<string> {
	if (facts === undefined) return []

	if (!facts.is_measured) {
		return ['', HEADING, time_format.format_columns(TOTAL_LABEL, '', NOT_MEASURED_NOTE)]
	}

	return ['', HEADING, ...measured_lines(facts)]
}

const time_phase_costs = {
	HEADING,
	UNATTRIBUTED_LABEL,
	UNATTRIBUTED_NOTE,
	TOTAL_LABEL,
	PER_TRIP_LABEL,
	DENOMINATOR_NOTE,
	NOT_MEASURED_NOTE,
	UNPRICED_LABEL,
	UNPRICED_NOTE,
	build,
	cost_lines,
}

export type { PhaseCost, PhaseCostFacts, PhaseCostInput, PricedRequest }
export { time_phase_costs }
