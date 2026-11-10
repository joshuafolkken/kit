import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import type { UsageRecord } from '#scripts/cost-runtime/cost-usage'
import { lane_stats } from '#scripts/lane/lane-stats'
import type { AuditSession } from './cost-audit-read'

// The usage breakdown of `josh cost:audit` (joshuafolkken/kit#7042): the figures a cost-reduction Issue
// declares its before and after on — the cache write by lifetime, each subagent type's runs, the context
// a session's first request carries, and the calls with a long output. Every figure is read off the
// priced requests, in tokens and the dollars `cost-pricing.ts` charges, never a weighted unit.
//
// **A subagent run is one delegated transcript** — a session with an agent type. A session's first
// request is its first priced request after `dedupe_across`, so a resumed session's first request is
// the first one an older transcript did not already hold.

// A call whose output passed this many tokens is a long-output call.
const LONG_OUTPUT_TOKENS = 2000

interface CacheWrite {
	tokens_5m: number
	tokens_1h: number
	usd_5m: number
	usd_1h: number
}

interface AgentRuns {
	agent_type: string
	runs: number
	calls: number
	usd: number
}

interface FirstContext {
	sessions: number
	p50_tokens: number | undefined
}

interface LongOutput {
	calls: number
	all_calls: number
	usd: number
}

interface UsageBreakdown {
	cache_write: CacheWrite
	agents: ReadonlyArray<AgentRuns>
	first_main: FirstContext
	first_subagent: FirstContext
	long_output: LongOutput
}

type IsInside = (at_ms: number | undefined) => boolean

// One request's cache write by lifetime; a model with no price adds its tokens at no dollars.
function record_cache_write(record: UsageRecord): CacheWrite {
	const price = cost_pricing.resolve_price(record.model)
	const tokens = {
		tokens_5m: record.totals.cache_write_5m_tokens,
		tokens_1h: record.totals.cache_write_1h_tokens,
	}

	if (price === undefined) return { ...tokens, usd_5m: 0, usd_1h: 0 }

	const terms = cost_pricing.estimate_composition(record.totals, price)

	return { ...tokens, usd_5m: terms.cache_write_5m_usd, usd_1h: terms.cache_write_1h_usd }
}

function cache_write_of(records: ReadonlyArray<UsageRecord>): CacheWrite {
	const total: CacheWrite = { tokens_5m: 0, tokens_1h: 0, usd_5m: 0, usd_1h: 0 }

	for (const record of records) {
		const write = record_cache_write(record)

		total.tokens_5m += write.tokens_5m
		total.tokens_1h += write.tokens_1h
		total.usd_5m += write.usd_5m
		total.usd_1h += write.usd_1h
	}

	return total
}

function add_run(
	runs: Map<string, AgentRuns>,
	agent_type: string,
	records: ReadonlyArray<UsageRecord>,
): void {
	const run = runs.get(agent_type) ?? { agent_type, runs: 0, calls: 0, usd: 0 }

	runs.set(agent_type, {
		agent_type,
		runs: run.runs + 1,
		calls: run.calls + records.length,
		usd: run.usd + cost_pricing.cost_of(records),
	})
}

// Each agent type's runs that issued a request inside the period, the costliest first.
function agents_of(sessions: ReadonlyArray<AuditSession>): Array<AgentRuns> {
	const runs = new Map<string, AgentRuns>()

	for (const session of sessions) {
		if (session.agent_type !== undefined && session.records.length > 0) {
			add_run(runs, session.agent_type, session.records)
		}
	}

	return [...runs.values()].toSorted((left, right) => right.usd - left.usd)
}

// The whole context a request was sent with: what it paid in full, read from cache and wrote to it.
function context_tokens(record: UsageRecord): number {
	const { input_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens } =
		record.totals

	return input_tokens + cache_read_tokens + cache_write_5m_tokens + cache_write_1h_tokens
}

// The median first-request context of the sessions that opened inside the period.
function first_context_of(
	sessions: ReadonlyArray<AuditSession>,
	is_inside: IsInside,
): FirstContext {
	const firsts = sessions
		.map((session) => session.records[0])
		.filter((record): record is UsageRecord => record !== undefined && is_inside(record.at_ms))
	const tokens = firsts.map((record) => context_tokens(record))

	return { sessions: tokens.length, p50_tokens: lane_stats.median(tokens) }
}

function long_output_of(records: ReadonlyArray<UsageRecord>): LongOutput {
	const long = records.filter((record) => record.totals.output_tokens > LONG_OUTPUT_TOKENS)

	return { calls: long.length, all_calls: records.length, usd: cost_pricing.cost_of(long) }
}

function is_subagent(session: AuditSession): boolean {
	return session.agent_type !== undefined
}

// The breakdown of the requests `is_inside` admits; `sessions` are uncut, so a first request is a
// session's own first rather than the first inside the period.
function breakdown_of(sessions: ReadonlyArray<AuditSession>, is_inside: IsInside): UsageBreakdown {
	const cut = sessions.map((session) => ({
		...session,
		records: session.records.filter((record) => is_inside(record.at_ms)),
	}))
	const records = cut.flatMap((session) => session.records)

	return {
		cache_write: cache_write_of(records),
		agents: agents_of(cut),
		first_main: first_context_of(
			sessions.filter((session) => !is_subagent(session)),
			is_inside,
		),
		first_subagent: first_context_of(
			sessions.filter((session) => is_subagent(session)),
			is_inside,
		),
		long_output: long_output_of(records),
	}
}

const cost_audit_usage = { LONG_OUTPUT_TOKENS, breakdown_of }

export type { AgentRuns, CacheWrite, FirstContext, LongOutput, UsageBreakdown }
export { cost_audit_usage }
