import { time_format } from './time-format'

// The attribution, arithmetic and row layout two cost blocks share (joshuafolkken/kit#1872).
//
// **`phase_costs` and the contributor-cost block ask one question of one corpus, keyed two ways.**
// Both take the run's billed requests, decide which stretch of wall clock each one landed in, and
// tally dollars into the bucket that stretch belongs to — `time-phase-costs.ts` labelling the
// stretch by phase and `time-contributor-costs.ts` by what the turn was for. The walk that places a
// request, the arithmetic that adds it, and the three-column row it prints are the same in both; a
// second copy beside the second block is the clone `CLAUDE.md` prohibits, in the one place a drift
// would make two cost tables of one report disagree about what a dollar bought.
//
// **A request inside no interval goes to a bucket of its own and is never prorated.** Spreading it
// across the labelled buckets in proportion would put money into stretches that demonstrably were
// not running — the confident zero this whole pair is written against. What that leftover *means*
// differs by caller (a phase gap, or a turn that called no tool), so the label for it stays each
// block's own; the bucket arithmetic that fills it does not.
//
// **It holds no timing vocabulary** — no phases, no contributors, no spans. That keeps the
// dependency one-way: both cost modules import this, and nothing here imports either of them.

const NONE = 0
const NO_COST = 0
const ONE_REQUEST = 1
const TOTAL_DECIMALS = 2
const TRIP_DECIMALS = 3

// A priced request, reduced to the two things attribution needs. `at_ms` is `undefined` where the
// transcript line carried no readable timestamp — such a request is priced but cannot be placed in
// any interval, and dropping it would quietly shrink the run's total.
interface PricedRequest {
	at_ms: number | undefined
	cost_usd: number
	// Whether the price table could cost this request's model at all. An unpriced one contributes a
	// request and no dollars, so without this flag a run on a model nobody has priced yet would print
	// every bucket at `$0.00` and read as a run that was free.
	is_priced: boolean
}

// What one row of a cost table holds. The leftover row is the same record with no label to name,
// which is why the two share one shape.
interface Bucket {
	request_count: number
	cost_usd: number
}

// One stretch of wall clock, carrying the label the caller put on it — a phase name, or a
// contributor. The label is a plain string so this module stays blind to which vocabulary it is.
interface LabeledRegion {
	start_ms: number
	end_ms: number
	label: string
}

interface Tally {
	by_label: Map<string, Bucket>
	unattributed: Bucket
}

const EMPTY_BUCKET: Bucket = { request_count: NONE, cost_usd: NO_COST }

function added(bucket: Bucket, cost_usd: number): Bucket {
	return {
		request_count: bucket.request_count + ONE_REQUEST,
		cost_usd: bucket.cost_usd + cost_usd,
	}
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

// The narrowest interval containing the instant — the first match, since the caller's regions are
// sorted by where they end before the search.
//
// **Both ends are closed, and the boundary case is the normal one.** Every assistant line closes a
// model span, so a request's instant equals that span's `ended_ms` and equals the next span's start;
// two regions therefore contain it. The one that *ends* there is the model wait for this very
// request, which is why the narrower end wins — and why the choice is made by the sort rather than by
// array order, which a cross-session concatenation does not put in time order.
function label_at(
	sorted: ReadonlyArray<LabeledRegion>,
	at_ms: number | undefined,
): string | undefined {
	if (at_ms === undefined) return undefined

	return sorted.find((region) => at_ms >= region.start_ms && at_ms <= region.end_ms)?.label
}

// Sort once here rather than at each caller, so a block that hands over regions in build order still
// gets the narrowest-end-first match `label_at` depends on.
function tally(
	regions: ReadonlyArray<LabeledRegion>,
	requests: ReadonlyArray<PricedRequest>,
): Tally {
	const sorted = regions.toSorted((left, right) => left.end_ms - right.end_ms)
	const by_label = new Map<string, Bucket>()
	let unattributed = EMPTY_BUCKET

	for (const request of requests) {
		const label = label_at(sorted, request.at_ms)

		if (label === undefined) unattributed = added(unattributed, request.cost_usd)
		else by_label.set(label, added(by_label.get(label) ?? EMPTY_BUCKET, request.cost_usd))
	}

	return { by_label, unattributed }
}

function unpriced_count(requests: ReadonlyArray<PricedRequest>): number {
	return requests.filter((request) => !request.is_priced).length
}

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

// One labelled row: its dollars in the numeric column, then its share of the block total and its
// request count. The share is against the block's own total, so it reads the same whichever block
// printed it.
function bucket_line(label: string, bucket: Bucket, total_cost: number): string {
	const share = time_format.format_share(bucket.cost_usd, total_cost)
	const suffix = [share, requests_text(bucket.request_count)].join(time_format.SUFFIX_SEPARATOR)

	return time_format.format_columns(label, usd(bucket.cost_usd, TOTAL_DECIMALS), suffix)
}

// The leftover row, carrying the caller's own word for what fell outside every interval and the note
// that says it was never prorated.
function leftover_line(label: string, bucket: Bucket, total_cost: number, note: string): string {
	const line = bucket_line(label, bucket, total_cost)

	return `${line}${time_format.SUFFIX_SEPARATOR}${note}`
}

function total_line(cost_usd: number, request_count: number, round_trip_count: number): string {
	const trips = `over ${String(round_trip_count)} round trip(s)`
	const suffix = [requests_text(request_count), trips].join(time_format.SUFFIX_SEPARATOR)

	return time_format.format_columns(TOTAL_LABEL, usd(cost_usd, TOTAL_DECIMALS), suffix)
}

function per_trip_line(usd_per_round_trip: number): string {
	return time_format.format_columns(
		PER_TRIP_LABEL,
		usd(usd_per_round_trip, TRIP_DECIMALS),
		DENOMINATOR_NOTE,
	)
}

// Printed only where there is something to say: a run whose every model was priced carries no such
// row, and a floor note over a complete reading would be as misleading as its absence over a partial
// one.
function unpriced_lines(unpriced_request_count: number): Array<string> {
	if (unpriced_request_count === NONE) return []

	const count = time_format.format_columns(UNPRICED_LABEL, String(unpriced_request_count), '')

	return [`${count.trimEnd()}${time_format.SUFFIX_SEPARATOR}${UNPRICED_NOTE}`]
}

const time_region_costs = {
	NONE,
	NO_COST,
	TOTAL_DECIMALS,
	EMPTY_BUCKET,
	TOTAL_LABEL,
	PER_TRIP_LABEL,
	DENOMINATOR_NOTE,
	NOT_MEASURED_NOTE,
	UNPRICED_LABEL,
	UNPRICED_NOTE,
	added,
	sum_of,
	label_at,
	tally,
	unpriced_count,
	usd,
	requests_text,
	bucket_line,
	leftover_line,
	total_line,
	per_trip_line,
	unpriced_lines,
}

export type { Bucket, LabeledRegion, PricedRequest, Tally }
export { time_region_costs }
