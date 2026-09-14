import { cost_format } from './cost-format'
import { cost_pricing } from './cost-pricing'
import { cost_usage, type UsageRecord } from './cost-usage'

// The axis `josh cost` did not have: where a request sits in the run, and how large its context is
// there (joshuafolkken/kit#1838). `resolve_price` gives one rate per model and the report reads a
// run as a flat request set, so the fact that the *late* requests are the large, expensive ones —
// the number a hand-off decision turns on — never appears.
//
// The curve is positional: records are split into four consecutive quartiles by their order in the
// run and each quartile is averaged. That is deliberately not `time-distribution`'s percentile of a
// sorted value set — sorting would discard the position, which is the whole point here.

const POSITION_BUCKETS = 4
const NOT_MEASURED = 'not measured'
const CURVE_HEADING = 'Cost curve (by request position):'

interface CurveBucket {
	label: string
	request_count: number
	// Absent, never 0, when the bucket has no request: a run of three requests leaves the fourth
	// quartile empty, and a "0 tokens" row would read as a measured zero rather than nothing measured.
	avg_context_tokens?: number
	// Absent when the bucket is empty or holds an unpriced model — the same floor convention the
	// report already uses for `cost_usd`.
	cost_usd?: number
}

interface Curve {
	// False when the scope mixes sessions and no single main-line session could be isolated — a
	// delegated unit starts from low context, so mixing its records into the positional quartiles
	// breaks the growth curve a hand-off decision reads (joshuafolkken/kit#1853). Withheld rather than
	// reported as a flat or downward curve, the same convention the buckets and the cap ratio use.
	measured: boolean
	buckets: Array<CurveBucket>
	first_context_tokens: number
	last_context_tokens: number
	// Only on a withheld curve: how many main-line sessions the scope had (0 = none found, ≥2 =
	// ambiguous, e.g. a run resumed in a second session).
	session_count?: number
}

interface CapSimulation {
	cap_tokens: number
	within_cap_requests: number
	total_requests: number
	// The share of the run's priced cost incurred by requests at or under the cap. Absent, never 0,
	// when nothing could be priced. It is the observed run's spend at or under the cap, not a
	// projection of a run replanned to hand off there — the deferred work would still have to happen.
	cost_ratio?: number
}

// A request's context size is its billed input: the accumulated preamble is what every turn re-sends,
// so billed input climbs across the run and is exactly the "37K → 427K" axis the issue describes.
function context_of(record: UsageRecord): number {
	return cost_usage.billed_input(record.totals)
}

function price_of(record: UsageRecord): number | undefined {
	const price = cost_pricing.resolve_price(record.model)

	return price === undefined ? undefined : cost_pricing.estimate_cost(record.totals, price)
}

function bucket_index(position: number, count: number): number {
	return Math.min(POSITION_BUCKETS - 1, Math.floor((position * POSITION_BUCKETS) / count))
}

function partition(records: ReadonlyArray<UsageRecord>): Array<Array<UsageRecord>> {
	const buckets: Array<Array<UsageRecord>> = Array.from({ length: POSITION_BUCKETS }, () => [])

	for (const [position, record] of records.entries()) {
		buckets[bucket_index(position, records.length)]?.push(record)
	}

	return buckets
}

function average(values: ReadonlyArray<number>): number {
	return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

// The priced total of a set of requests, and whether the set could be priced at all. A set holding
// an unpriced model reports no total rather than a partial one silently read as whole.
function priced_cost(records: ReadonlyArray<UsageRecord>): number | undefined {
	const prices = records.map((record) => price_of(record))

	if (prices.includes(undefined)) return undefined

	return prices.reduce((sum: number, price) => sum + (price ?? 0), 0)
}

// The priced sum, ignoring unpriced requests, for the cap ratio. Unpriced requests drop from both
// the numerator and the denominator, so the ratio is over the priced portion consistently.
function priced_sum(records: ReadonlyArray<UsageRecord>): number {
	return records.reduce((sum, record) => sum + (price_of(record) ?? 0), 0)
}

function optional_cost(cost: number | undefined): { cost_usd?: number } {
	return cost === undefined ? {} : { cost_usd: cost }
}

function to_bucket(records: ReadonlyArray<UsageRecord>, index: number): CurveBucket {
	const label = `Q${String(index + 1)}`

	if (records.length === 0) return { label, request_count: 0 }

	return {
		label,
		request_count: records.length,
		avg_context_tokens: average(records.map((record) => context_of(record))),
		...optional_cost(priced_cost(records)),
	}
}

// The context of the record at `index`, or 0 for an out-of-range index. Only ever called on a
// non-empty run (the report omits the curve for an empty scope), so the guard is defensive.
function endpoint(records: ReadonlyArray<UsageRecord>, index: number): number {
	const record = records[index]

	return record === undefined ? 0 : context_of(record)
}

function build_curve(records: ReadonlyArray<UsageRecord>): Curve {
	return {
		measured: true,
		buckets: partition(records).map((bucket, index) => to_bucket(bucket, index)),
		first_context_tokens: endpoint(records, 0),
		last_context_tokens: endpoint(records, records.length - 1),
	}
}

// A withheld curve: the scope had no single main-line session to read the growth from. `session_count`
// says why — 0 that none was in scope, ≥2 that several were and the run could not be isolated.
function mixed_curve(session_count: number): Curve {
	return {
		measured: false,
		buckets: [],
		first_context_tokens: 0,
		last_context_tokens: 0,
		session_count,
	}
}

// The curve is built from the main-line session's records alone. The caller passes the in-scope
// records of each non-delegated session grouped by session: exactly one non-empty group builds the
// positional curve, and zero or several withhold it. A single-session scope is one group and behaves
// exactly as before (joshuafolkken/kit#1853).
function curve_for_sessions(sessions: ReadonlyArray<ReadonlyArray<UsageRecord>>): Curve {
	const non_empty = sessions.filter((session) => session.length > 0)
	const [only] = non_empty

	if (only !== undefined && non_empty.length === 1) return build_curve(only)

	return mixed_curve(non_empty.length)
}

function optional_ratio(within: number, total: number): { cost_ratio?: number } {
	return total === 0 ? {} : { cost_ratio: within / total }
}

function simulate_cap(records: ReadonlyArray<UsageRecord>, cap_tokens: number): CapSimulation {
	const within = records.filter((record) => context_of(record) <= cap_tokens)

	return {
		cap_tokens,
		within_cap_requests: within.length,
		total_requests: records.length,
		...optional_ratio(priced_sum(within), priced_sum(records)),
	}
}

function ratio_text(cap: CapSimulation): string {
	if (cap.cost_ratio === undefined) return NOT_MEASURED

	return cost_format.format_share(cap.cost_ratio, 1)
}

function bucket_context_text(bucket: CurveBucket): string {
	if (bucket.avg_context_tokens === undefined) return NOT_MEASURED

	return cost_format.format_tokens(bucket.avg_context_tokens)
}

function bucket_cost_text(bucket: CurveBucket): string {
	if (bucket.cost_usd === undefined) return NOT_MEASURED

	return cost_format.format_usd(bucket.cost_usd)
}

function bucket_line(bucket: CurveBucket): string {
	return `  ${bucket.label}  ${String(bucket.request_count)} req   avg context ${bucket_context_text(bucket)}   cost ${bucket_cost_text(bucket)}`
}

function mixed_reason(session_count: number | undefined): string {
	if (session_count === undefined || session_count === 0) return 'no main-line session in scope'

	return `scope spans ${String(session_count)} main-line sessions — cannot isolate the run`
}

function format_curve_lines(curve: Curve): Array<string> {
	if (!curve.measured) {
		return ['', CURVE_HEADING, `  ${NOT_MEASURED} — ${mixed_reason(curve.session_count)}`]
	}

	return [
		'',
		CURVE_HEADING,
		`  first request context ${cost_format.format_tokens(curve.first_context_tokens)} → last ${cost_format.format_tokens(curve.last_context_tokens)}`,
		...curve.buckets.map((bucket) => bucket_line(bucket)),
	]
}

function format_cap_lines(cap: CapSimulation): Array<string> {
	return [
		'',
		`Cap simulation (${cost_format.format_tokens(cap.cap_tokens)} tokens/request):`,
		`  ${String(cap.within_cap_requests)} of ${String(cap.total_requests)} request(s) at or under the cap account for ${ratio_text(cap)} of priced cost`,
	]
}

const cost_curve = {
	POSITION_BUCKETS,
	NOT_MEASURED,
	context_of,
	price_of,
	build_curve,
	curve_for_sessions,
	simulate_cap,
	ratio_text,
	format_curve_lines,
	format_cap_lines,
}

export type { CapSimulation, Curve, CurveBucket }
export { cost_curve }
