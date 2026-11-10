import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import type { UsageRecord, UsageTotals } from '#scripts/cost-runtime/cost-usage'
import { lane_breakdown, type Breakdown } from '#scripts/lane/lane-breakdown'
import { cost_audit_kind } from './cost-audit-kind'
import type { AuditSession } from './cost-audit-read'
import { cost_audit_spend, type ModelSpend } from './cost-audit-spend'
import type { ToolCategory } from './cost-audit-tool'
import { cost_audit_usage } from './cost-audit-usage'

// The lane children's tokens and cost by the phase each request fell in, for `josh cost:audit`
// (joshuafolkken/kit#5936), so a change aimed at one phase is read against that phase's figure rather
// than the cost per merge alone.
//
// **The phase boundaries are `lane_breakdown`'s**: a request is placed by its instant in the stage spans
// `lane_breakdown.of` cuts for its lane's time, never by a boundary defined here. Inside the
// implementation a request splits by the calls it issued — a check, an edit, a read. A request after the
// lane's first review request, inside the implementation or between ship stages (where a stopped ship's
// fix runs), is the review's fix. A review session's request is its round: round 2 inside the ship's
// `round-2` stage, round 1 elsewhere. A request of a lane with no breakdown (not merged yet) or outside
// its span is `unattributed`.

const REVIEW_KIND = cost_audit_kind.REVIEW
const PLAN = 'plan'
const UNATTRIBUTED = 'unattributed'
const ROUND_ONE = 'review round 1'
const ROUND_TWO = 'review round 2'
const IMPLEMENT_LEAD = 'implement: '
const REVIEW_FIX = 'review-fix'
const AGENT_LEAD = 'subagent: '
// A request that issued none of the calls below edits or thinks — the remainder `lane:breakdown`
// names `editing & thinking`.
const EDIT = 'edit'

// The implementation's sub-phase by the calls a request issued, the first match winning.
const IMPLEMENT_KINDS: ReadonlyArray<readonly [ToolCategory, string]> = [
	['verification', 'check'],
	['edit', EDIT],
	['code search', 'read'],
	['doc read', 'read'],
]

interface PhaseTokens {
	input: number
	cache_read: number
	cache_write: number
	output: number
}

interface PhaseRow {
	key: string
	tokens: PhaseTokens
	usd: number
	// The row's dollars by model and token type (joshuafolkken/kit#6899), summing to `usd`.
	models: ReadonlyArray<ModelSpend>
	// The row's requests whose output passed `LONG_OUTPUT_TOKENS` (joshuafolkken/kit#7045).
	long_calls: number
}

interface Placed {
	session: AuditSession
	record: UsageRecord
	breakdown: Breakdown | undefined
	review_from_ms: number | undefined
}

const NO_TOKENS: PhaseTokens = { input: 0, cache_read: 0, cache_write: 0, output: 0 }

function tokens_of(totals: UsageTotals): PhaseTokens {
	return {
		input: totals.input_tokens,
		cache_read: totals.cache_read_tokens,
		cache_write: totals.cache_write_5m_tokens + totals.cache_write_1h_tokens,
		output: totals.output_tokens,
	}
}

function summed(left: PhaseTokens, right: PhaseTokens): PhaseTokens {
	return {
		input: left.input + right.input,
		cache_read: left.cache_read + right.cache_read,
		cache_write: left.cache_write + right.cache_write,
		output: left.output + right.output,
	}
}

function implement_kind(categories: ReadonlyArray<ToolCategory>): string {
	return IMPLEMENT_KINDS.find(([category]) => categories.includes(category))?.[1] ?? EDIT
}

function is_fix(placed: Placed, at_ms: number): boolean {
	return placed.review_from_ms !== undefined && at_ms > placed.review_from_ms
}

function implement_phase(placed: Placed, at_ms: number): string {
	const categories = placed.session.categories.get(placed.record.request_id) ?? []

	return `${IMPLEMENT_LEAD}${is_fix(placed, at_ms) ? REVIEW_FIX : implement_kind(categories)}`
}

// Between ship stages a request after the review is the fix of a stopped ship; any other is the stage's.
function between_phase(placed: Placed, at_ms: number): string {
	return is_fix(placed, at_ms) ? `${IMPLEMENT_LEAD}${REVIEW_FIX}` : lane_breakdown.BETWEEN_STAGE
}

function review_round(stage: string): string {
	return stage === lane_breakdown.ROUND_TWO_STAGE ? ROUND_TWO : ROUND_ONE
}

function stage_phase(placed: Placed, stage: string, at_ms: number): string {
	if (placed.session.kind === REVIEW_KIND) return review_round(stage)
	if (stage === lane_breakdown.PLAN_STAGE) return PLAN
	if (stage === lane_breakdown.IMPLEMENT_STAGE) return implement_phase(placed, at_ms)

	return stage === lane_breakdown.BETWEEN_STAGE ? between_phase(placed, at_ms) : stage
}

function phase_of(placed: Placed): string {
	const { at_ms } = placed.record

	if (at_ms === undefined || placed.breakdown === undefined) return UNATTRIBUTED

	const stage = lane_breakdown.stage_at(placed.breakdown, at_ms)

	return stage === undefined ? UNATTRIBUTED : stage_phase(placed, stage, at_ms)
}

// The instant the lane's first review request completed, `undefined` for a lane with no review.
function review_from_ms(sessions: ReadonlyArray<AuditSession>, issue: number): number | undefined {
	const instants = sessions
		.filter((session) => session.issue === issue && session.kind === REVIEW_KIND)
		.flatMap((session) => session.records.map((record) => record.at_ms))
		.filter((at_ms) => at_ms !== undefined)

	return instants.length === 0 ? undefined : Math.min(...instants)
}

type RecordGroups = Map<string, Array<UsageRecord>>

function add_record(groups: RecordGroups, key: string, record: UsageRecord): void {
	groups.set(key, [...(groups.get(key) ?? []), record])
}

function tokens_sum(records: ReadonlyArray<UsageRecord>): PhaseTokens {
	let tokens = NO_TOKENS

	for (const record of records) tokens = summed(tokens, tokens_of(record.totals))

	return tokens
}

function row_of(key: string, records: ReadonlyArray<UsageRecord>): PhaseRow {
	return {
		key,
		tokens: tokens_sum(records),
		usd: cost_pricing.cost_of(records),
		models: cost_audit_spend.spend_of(records),
		long_calls: cost_audit_usage.long_calls_of(records),
	}
}

interface PhaseInput {
	sessions: ReadonlyArray<AuditSession>
	// Every session, not windowed: a lane's first review may fall before the window its fix falls in.
	reviews: ReadonlyArray<AuditSession>
	breakdowns: ReadonlyMap<number, Breakdown>
}

function add_session(rows: RecordGroups, input: PhaseInput, session: AuditSession): void {
	const { issue } = session

	if (issue === undefined) return

	const breakdown = input.breakdowns.get(issue)
	const from_ms = review_from_ms(input.reviews, issue)

	for (const record of session.records) {
		add_record(rows, phase_of({ session, record, breakdown, review_from_ms: from_ms }), record)
	}
}

function sorted(groups: RecordGroups): Array<PhaseRow> {
	return [...groups]
		.map(([key, records]) => row_of(key, records))
		.toSorted((left, right) => right.usd - left.usd)
}

// Every lane session's requests (already windowed) summed by phase, the costliest first.
function rows_of(input: PhaseInput): Array<PhaseRow> {
	const rows: RecordGroups = new Map()

	for (const session of input.sessions) add_session(rows, input, session)

	return sorted(rows)
}

function agent_key(session: AuditSession): string {
	return session.agent_type === undefined ? session.kind : `${AGENT_LEAD}${session.agent_type}`
}

// A lane's delegated unit — in the lane's directory, yet not the lane child's own session.
function add_unit(rows: RecordGroups, session: AuditSession): void {
	if (session.issue === undefined || session.is_lane) return

	for (const record of session.records) add_record(rows, agent_key(session), record)
}

// The lane children's delegated units' requests (already windowed) summed by agent type, a unit with no
// `meta.json` under its kind (joshuafolkken/kit#5971), the costliest first.
function agent_rows_of(sessions: ReadonlyArray<AuditSession>): Array<PhaseRow> {
	const rows: RecordGroups = new Map()

	for (const session of sessions) add_unit(rows, session)

	return sorted(rows)
}

const cost_audit_phase = { PLAN, ROUND_ONE, ROUND_TWO, UNATTRIBUTED, agent_rows_of, rows_of }

export type { PhaseRow, PhaseTokens }
export { cost_audit_phase }
