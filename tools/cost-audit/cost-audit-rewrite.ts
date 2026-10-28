import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import { cost_usage, type UsageRecord } from '#scripts/cost-runtime/cost-usage'

// The full prompt-cache rewrites `josh cost:audit` counts (joshuafolkken/kit#5344): a request that
// wrote the whole context again instead of reading it back, split by the gap since the request before
// it. A gap of the 5-minute cache TTL or more is the wait a lane paid for; a rewrite inside the TTL is
// a changed prefix.
//
// **A large write is not a rewrite by itself**: a long tool result or a subagent report is new
// content appended after a prefix read back in full. A rewrite reads back under half of what the
// request before it held, so an append is never counted however large.

const REWRITE_FLOOR_TOKENS = 15_000
const CACHE_TTL_MS = 300_000
const READ_BACK_SHARE = 0.5

interface RewriteCount {
	count: number
	usd: number
}

interface Rewrites {
	after_wait: RewriteCount
	within_ttl: RewriteCount
}

interface RecordedSession {
	records: ReadonlyArray<UsageRecord>
}

type IsCounted = (at_ms: number | undefined) => boolean

function written(record: UsageRecord): number {
	return record.totals.cache_write_5m_tokens + record.totals.cache_write_1h_tokens
}

function is_rewrite(record: UsageRecord, before: UsageRecord): boolean {
	const held = before.totals.cache_read_tokens + written(before)

	return (
		written(record) > REWRITE_FLOOR_TOKENS &&
		record.totals.cache_read_tokens < held * READ_BACK_SHARE
	)
}

// A rewrite is priced at its cache write alone: the rest of the request is billed either way.
function write_cost(record: UsageRecord): number {
	const { cache_write_5m_tokens, cache_write_1h_tokens } = record.totals
	const totals = { ...cost_usage.EMPTY_TOTALS, cache_write_5m_tokens, cache_write_1h_tokens }

	return cost_pricing.cost_of([{ model: record.model, totals }])
}

function add_rewrite(rewrites: Rewrites, record: UsageRecord, before: UsageRecord): void {
	const gap_ms = (record.at_ms ?? 0) - (before.at_ms ?? 0)
	const bucket = gap_ms >= CACHE_TTL_MS ? rewrites.after_wait : rewrites.within_ttl

	bucket.count += 1
	bucket.usd += write_cost(record)
}

// Each request in time order with the one before it. A session's first request writes its context by
// necessity, so it has no pair and is never a rewrite.
function pairs_of(records: ReadonlyArray<UsageRecord>): Array<[UsageRecord, UsageRecord]> {
	const ordered = records.toSorted((left, right) => (left.at_ms ?? 0) - (right.at_ms ?? 0))

	return ordered.slice(1).flatMap((record, index): Array<[UsageRecord, UsageRecord]> => {
		const before = ordered[index]

		return before === undefined ? [] : [[record, before]]
	})
}

// The request before a counted one may sit outside the window the request is counted in.
function add_session(rewrites: Rewrites, session: RecordedSession, is_counted: IsCounted): void {
	for (const [record, before] of pairs_of(session.records)) {
		const is_counted_rewrite = is_counted(record.at_ms) && is_rewrite(record, before)

		if (is_counted_rewrite) add_rewrite(rewrites, record, before)
	}
}

function rewrites_in(sessions: ReadonlyArray<RecordedSession>, is_counted: IsCounted): Rewrites {
	const rewrites: Rewrites = { after_wait: { count: 0, usd: 0 }, within_ttl: { count: 0, usd: 0 } }

	for (const session of sessions) add_session(rewrites, session, is_counted)

	return rewrites
}

const cost_audit_rewrite = { REWRITE_FLOOR_TOKENS, rewrites_in }

export type { RewriteCount, Rewrites }
export { cost_audit_rewrite }
