import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import { cost_usage, type UsageRecord } from '#scripts/cost-runtime/cost-usage'
import type { AuditSession } from './cost-audit-read'
import { cost_audit_rewrite } from './cost-audit-rewrite'
import { cost_audit_usage, type CacheWrite } from './cost-audit-usage'

// The prompt-cache write of `josh cost:audit` by cause (joshuafolkken/kit#7877): every request that
// wrote to the cache goes to exactly one cause, so the rows add up to the period's cache write.
//
// **A session's first request writes the context it opens with**: a subagent's is its launch, a
// `resume` session's is the lane child picked up after a cut (the audit data holds no `run:cut` mark,
// so the resume kind is the only trace), and any other session's is its start. A later request is a
// full rewrite after a wait when `cost-audit-rewrite.ts` counts it so; everything else is `other`.

const SUBAGENT_START = 'subagent start'
const RESUME_AFTER_CUT = 'resume after cut'
const SESSION_START = 'session start'
const AFTER_WAIT = 'rewrite after a wait of 5 min or more'
const OTHER = 'other'
const CAUSES = [SUBAGENT_START, RESUME_AFTER_CUT, SESSION_START, AFTER_WAIT, OTHER] as const
const RESUME_KIND = 'resume'

type Cause = (typeof CAUSES)[number]

type CausedSession = Pick<AuditSession, 'kind' | 'agent_type' | 'records'>

type IsCounted = (at_ms: number | undefined) => boolean

interface CausedRequest {
	record: UsageRecord
	cause: Cause
}

interface CauseFigures {
	writes: number
	write: CacheWrite
	// The 1h tokens priced at the 5m write rate, to read whether the longer lifetime paid for itself.
	usd_1h_at_5m: number
}

interface CauseRow {
	cause: Cause
	current: CauseFigures
	previous: CauseFigures
}

interface CauseWindows {
	current: IsCounted
	previous: IsCounted
}

function first_cause(session: CausedSession): Cause {
	if (session.agent_type !== undefined) return SUBAGENT_START

	return session.kind === RESUME_KIND ? RESUME_AFTER_CUT : SESSION_START
}

function later_cause(record: UsageRecord, before: UsageRecord): Cause {
	return cost_audit_rewrite.is_wait_rewrite(record, before) ? AFTER_WAIT : OTHER
}

// Each request of the session with its cause, the first in time order taken as the session's opening.
function caused(session: CausedSession): Array<CausedRequest> {
	const pairs = cost_audit_rewrite.pairs_of(session.records)
	const first = pairs[0]?.[1] ?? session.records[0]
	const later = pairs.map(([record, before]) => ({ record, cause: later_cause(record, before) }))

	return first === undefined ? later : [{ record: first, cause: first_cause(session) }, ...later]
}

function has_write(record: UsageRecord): boolean {
	return record.totals.cache_write_5m_tokens + record.totals.cache_write_1h_tokens > 0
}

function usd_1h_at_5m(record: UsageRecord): number {
	const price = cost_pricing.resolve_price(record.model)

	if (price === undefined) return 0

	const totals = {
		...cost_usage.EMPTY_TOTALS,
		cache_write_5m_tokens: record.totals.cache_write_1h_tokens,
	}

	return cost_pricing.estimate_composition(totals, price).cache_write_5m_usd
}

function sum_1h_at_5m(records: ReadonlyArray<UsageRecord>): number {
	let total = 0

	for (const record of records) total += usd_1h_at_5m(record)

	return total
}

function figures_of(records: ReadonlyArray<UsageRecord>): CauseFigures {
	return {
		writes: records.length,
		write: cost_audit_usage.cache_write_of(records),
		usd_1h_at_5m: sum_1h_at_5m(records),
	}
}

function figures_in(
	requests: ReadonlyArray<CausedRequest>,
	cause: Cause,
	is_counted: IsCounted,
): CauseFigures {
	const records = requests
		.filter((request) => request.cause === cause && is_counted(request.record.at_ms))
		.map((request) => request.record)

	return figures_of(records.filter((record) => has_write(record)))
}

// One row per cause in `CAUSES` order, each set beside the period before.
function causes_in(sessions: ReadonlyArray<CausedSession>, windows: CauseWindows): Array<CauseRow> {
	const requests = sessions.flatMap((session) => caused(session))

	return CAUSES.map((cause) => ({
		cause,
		current: figures_in(requests, cause, windows.current),
		previous: figures_in(requests, cause, windows.previous),
	}))
}

function usd_of(figures: CauseFigures): number {
	return figures.write.usd_5m + figures.write.usd_1h
}

const cost_audit_cause = { CAUSES, causes_in, usd_of }

export type { Cause, CauseFigures, CauseRow }
export { cost_audit_cause }
