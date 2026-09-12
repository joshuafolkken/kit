import { cost_curve } from './cost-curve'
import { cost_format } from './cost-format'
import type { UsageRecord } from './cost-usage'

// The requests the totals and the curve both hide: a single round trip whose cache write dominated
// the run (joshuafolkken/kit#1853). `josh cost` reads a run as a flat set and a four-quartile curve,
// so a lone request that rewrote the whole prefix — a mid-run Skill load invalidating the cache —
// averages into a quartile and never appears on its own. This surfaces the largest few directly,
// each with when it happened and what it cost.

const TOP_N = 3
const MS_PER_MINUTE = 60_000
const MINUTE_PRECISION = 10

interface Outlier {
	request_id: string
	// Minutes from the scope's first request, absent when either timestamp could not be read. Absent,
	// never 0: a request with no readable instant is not one that happened at the start.
	at_minute?: number
	// Cache creation is the write half of the bill — the 5-minute and 1-hour writes together — and it
	// is what a prefix invalidation spends, so it is the axis these are ranked on.
	cache_creation_tokens: number
	// Absent for a model the price table does not know — the same floor convention the report uses.
	cost_usd?: number
}

interface Outliers {
	requests: Array<Outlier>
}

function cache_creation_of(record: UsageRecord): number {
	return record.totals.cache_write_5m_tokens + record.totals.cache_write_1h_tokens
}

// The scope's earliest readable instant, from which every offset is measured. Absent when no record
// carried a timestamp, in which case no offset can be reported for any of them.
function base_ms(records: ReadonlyArray<UsageRecord>): number | undefined {
	const times = records.map((record) => record.at_ms).filter((at): at is number => at !== undefined)

	return times.length === 0 ? undefined : Math.min(...times)
}

function at_minute_of(record: UsageRecord, base: number | undefined): number | undefined {
	if (base === undefined || record.at_ms === undefined) return undefined

	return Math.round(((record.at_ms - base) / MS_PER_MINUTE) * MINUTE_PRECISION) / MINUTE_PRECISION
}

function optional_minute(minute: number | undefined): { at_minute?: number } {
	return minute === undefined ? {} : { at_minute: minute }
}

function optional_cost(cost: number | undefined): { cost_usd?: number } {
	return cost === undefined ? {} : { cost_usd: cost }
}

function to_outlier(record: UsageRecord, base: number | undefined): Outlier {
	return {
		request_id: record.request_id,
		cache_creation_tokens: cache_creation_of(record),
		...optional_minute(at_minute_of(record, base)),
		...optional_cost(cost_curve.price_of(record)),
	}
}

// The top few requests by cache write, largest first. A request that wrote no cache is dropped —
// the outlier reading is about a write that spiked, and a run of small requests has none to show
// rather than a list padded with zeroes.
function build_outliers(records: ReadonlyArray<UsageRecord>): Outliers {
	const base = base_ms(records)
	const ranked = records
		.filter((record) => cache_creation_of(record) > 0)
		.toSorted((left, right) => cache_creation_of(right) - cache_creation_of(left))
		.slice(0, TOP_N)

	return { requests: ranked.map((record) => to_outlier(record, base)) }
}

function minute_text(outlier: Outlier): string {
	return outlier.at_minute === undefined ? 'time unknown' : `${String(outlier.at_minute)} min`
}

function cost_text(outlier: Outlier): string {
	return outlier.cost_usd === undefined ? 'unpriced' : cost_format.format_usd(outlier.cost_usd)
}

function outlier_line(outlier: Outlier): string {
	const tokens = cost_format.format_tokens(outlier.cache_creation_tokens)

	return `  ${minute_text(outlier)}  cache write ${tokens}  ${cost_text(outlier)}`
}

// Printed only when there is an outlier to show. A run with no cache write spiked has nothing to say
// here, and a heading over an empty list would read as a measurement of nothing.
function format_outlier_lines(outliers: Outliers): Array<string> {
	if (outliers.requests.length === 0) return []

	return [
		'',
		'Largest requests (by cache write):',
		...outliers.requests.map((outlier) => outlier_line(outlier)),
	]
}

const cost_outliers = {
	TOP_N,
	cache_creation_of,
	build_outliers,
	format_outlier_lines,
}

export type { Outlier, Outliers }
export { cost_outliers }
