import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import type { UsageRecord } from '#scripts/cost-runtime/cost-usage'
import type { Breakdown } from '#scripts/lane/lane-breakdown'
import { guard_friction } from '#tools/retrospective/guard-friction'
import { cost_audit_cause, type CauseRow } from './cost-audit-cause'
import { cost_audit_density, type Density } from './cost-audit-density'
import { cost_audit_kind } from './cost-audit-kind'
import { cost_audit_phase, type PhaseRow } from './cost-audit-phase'
import type { AuditSession } from './cost-audit-read'
import { cost_audit_result, type ResultBreakdown } from './cost-audit-result'
import { cost_audit_resume, type TriggerRow } from './cost-audit-resume'
import { cost_audit_review_trigger, type ReviewTriggers } from './cost-audit-review-trigger'
import { cost_audit_rewrite, type Rewrites } from './cost-audit-rewrite'
import { cost_audit_sequence, type Sequences } from './cost-audit-sequence'
import { cost_audit_session_count, type SessionCounts } from './cost-audit-session-count'
import { cost_audit_spend, type ModelSpend } from './cost-audit-spend'
import { cost_audit_tool } from './cost-audit-tool'
import { cost_audit_usage, type UsageBreakdown } from './cost-audit-usage'
import { cost_audit_wait, type WaitTable } from './cost-audit-wait'

// The aggregation half of `josh cost:audit`: one period's cost broken down by session kind, tool
// category and guard, set beside the period before it, with every row that grew past the regression
// threshold flagged. A pure function of the sessions and the merge counts, so it is tested on fixed
// inputs rather than the live store.
//
// **A request's cost goes to the calls it issued**, split evenly among them: the request is what the
// model was paid to produce, and the calls are what it produced. A guard's cost is the round trip
// `guard-friction.ts` already prices, so the audit and the retrospective name one figure per guard.

// **The regression threshold.** A row is a regression when it grew by more than this share of the
// previous period's figure and is at least the floor in dollars — the floor keeps a row moving from
// cents to more cents out of the list.
const REGRESSION_THRESHOLD = { ratio: 0.2, floor_usd: 1 } as const
const DEFAULT_PERIOD_DAYS = 7
const MS_PER_DAY = 86_400_000
const PERIOD_COUNT = 2

interface AuditWindow {
	start_ms: number
	end_ms: number
}

interface MergeCounts {
	current: number
	previous: number
}

interface AuditRow {
	key: string
	current: number
	previous: number
	is_regression: boolean
	// The current period's spend per model, on the session-kind rows (joshuafolkken/kit#6913).
	models?: ReadonlyArray<ModelSpend>
	// Each period's session count, on the session-kind rows (joshuafolkken/kit#8329).
	sessions?: SessionCounts
}

interface LaneDensity {
	current: Density
	previous: Density
}

interface Audit {
	days: number
	lane_density: LaneDensity
	total: AuditRow
	merges: MergeCounts | undefined
	per_merge: AuditRow | undefined
	kinds: ReadonlyArray<AuditRow>
	tools: ReadonlyArray<AuditRow>
	guards: ReadonlyArray<AuditRow>
	// The current period's after-wait rewrites by kind, phase and preceding call (kit#8308).
	rewrites: { current: Rewrites; previous: Rewrites; waits: ReadonlyArray<WaitTable> }
	// The cache write by cause, each row set beside the period before (joshuafolkken/kit#7877).
	write_causes: ReadonlyArray<CauseRow>
	// The current period's lane requests by phase (joshuafolkken/kit#5936).
	phases: ReadonlyArray<PhaseRow>
	// The current period's lane delegated units by agent type (joshuafolkken/kit#5971).
	agents: ReadonlyArray<PhaseRow>
	// The current period's usage breakdown (joshuafolkken/kit#7042).
	usage: UsageBreakdown
	// The current period's cost by effort and tool-result characters (joshuafolkken/kit#7055).
	results: ResultBreakdown
	// The current period's Bash command runs and refusal retries (joshuafolkken/kit#7138).
	sequences: Sequences
	// The resume sessions by trigger, each period's (joshuafolkken/kit#8311).
	resumes: ResumeBreakdown
	// The reviewer runs by trigger, each period's (joshuafolkken/kit#8361).
	review_triggers: ReviewTriggers
}

interface ResumeBreakdown {
	triggers: ReadonlyArray<TriggerRow>
	// The resume sessions' dollars inside the `implement: review-fix` phase.
	review_fix: AuditRow
}

interface AuditInput {
	sessions: ReadonlyArray<AuditSession>
	days: number
	now_ms: number
	merges: MergeCounts | undefined
	// Each lane's stages by its Issue, for the phase table; absent, every lane request is unattributed.
	breakdowns?: ReadonlyMap<number, Breakdown>
	// The Issues the lane ledger records a merge of; absent, the ledger could not be read.
	merged_issues?: ReadonlySet<number> | undefined
}

interface PeriodCost {
	total: number
	kinds: Map<string, number>
	tools: Map<string, number>
	guards: Map<string, number>
}

function windows_of(days: number, now_ms: number): [AuditWindow, AuditWindow] {
	const span = days * MS_PER_DAY

	return [
		{ start_ms: now_ms - span, end_ms: now_ms },
		{ start_ms: now_ms - span * PERIOD_COUNT, end_ms: now_ms - span },
	]
}

function is_inside(at_ms: number | undefined, window: AuditWindow): boolean {
	return at_ms !== undefined && at_ms >= window.start_ms && at_ms < window.end_ms
}

function add(totals: Map<string, number>, key: string, usd: number): void {
	totals.set(key, (totals.get(key) ?? 0) + usd)
}

function add_request(period: PeriodCost, session: AuditSession, record: UsageRecord): void {
	const usd = cost_pricing.cost_of([record])
	const categories = session.categories.get(record.request_id) ?? [cost_audit_tool.REPLY]

	period.total += usd
	add(period.kinds, session.kind, usd)
	for (const category of categories) add(period.tools, category, usd / categories.length)
}

// The sessions cut to one window: the requests and lines inside it, for the guard tally.
function inside(sessions: ReadonlyArray<AuditSession>, window: AuditWindow): Array<AuditSession> {
	return sessions.map((session) => ({
		...session,
		records: session.records.filter((record) => is_inside(record.at_ms, window)),
		lines: session.lines.filter((line) => is_inside(line.timestamp_ms, window)),
	}))
}

function guard_costs(sessions: ReadonlyArray<AuditSession>): Map<string, number> {
	const sources = sessions.map((session) => ({ node: session, lines: session.lines }))

	return new Map(guard_friction.guard_rows(sources).map((guard) => [guard.guard, guard.usd]))
}

function period_cost(sessions: ReadonlyArray<AuditSession>, window: AuditWindow): PeriodCost {
	const cut = inside(sessions, window)
	const period: PeriodCost = {
		total: 0,
		kinds: new Map(),
		tools: new Map(),
		guards: guard_costs(cut),
	}

	for (const session of cut) {
		for (const record of session.records) add_request(period, session, record)
	}

	return period
}

function is_regression(current: number, previous: number): boolean {
	const limit = previous * (1 + REGRESSION_THRESHOLD.ratio)

	return current >= REGRESSION_THRESHOLD.floor_usd && current > limit
}

function row(key: string, current: number, previous: number): AuditRow {
	return { key, current, previous, is_regression: is_regression(current, previous) }
}

// Every key either period holds, the costliest in the current period first.
function rows_of(current: Map<string, number>, previous: Map<string, number>): Array<AuditRow> {
	const keys = new Set([...current.keys(), ...previous.keys()])

	return [...keys]
		.map((key) => row(key, current.get(key) ?? 0, previous.get(key) ?? 0))
		.toSorted((left, right) => right.current - left.current)
}

function per_merge(
	current: PeriodCost,
	previous: PeriodCost,
	merges: MergeCounts | undefined,
): AuditRow | undefined {
	if (merges === undefined || merges.current === 0 || merges.previous === 0) return undefined

	return row('per merge', current.total / merges.current, previous.total / merges.previous)
}

function rewrites_inside(sessions: ReadonlyArray<AuditSession>, window: AuditWindow): Rewrites {
	return cost_audit_rewrite.rewrites_in(sessions, (at_ms) => is_inside(at_ms, window))
}

function rewrites(
	input: AuditInput,
	current: AuditWindow,
	previous: AuditWindow,
): Audit['rewrites'] {
	return {
		current: rewrites_inside(input.sessions, current),
		previous: rewrites_inside(input.sessions, previous),
		waits: cost_audit_wait.waits_of({
			sessions: input.sessions,
			breakdowns: input.breakdowns ?? new Map<number, Breakdown>(),
			is_counted: (at_ms) => is_inside(at_ms, current),
		}),
	}
}

function write_causes(
	sessions: ReadonlyArray<AuditSession>,
	current: AuditWindow,
	previous: AuditWindow,
): Array<CauseRow> {
	return cost_audit_cause.causes_in(sessions, {
		current: (at_ms) => is_inside(at_ms, current),
		previous: (at_ms) => is_inside(at_ms, previous),
	})
}

function records_by_kind(sessions: ReadonlyArray<AuditSession>): Map<string, Array<UsageRecord>> {
	const records = new Map<string, Array<UsageRecord>>()

	for (const session of sessions) {
		records.set(session.kind, [...(records.get(session.kind) ?? []), ...session.records])
	}

	return records
}

// The kind rows, each carrying its current-period requests' spend per model and token type, and each
// period's session count.
function kind_rows(
	input: AuditInput,
	costs: { current: PeriodCost; previous: PeriodCost },
	windows: { current: AuditWindow; previous: AuditWindow },
): Array<AuditRow> {
	const cut = inside(input.sessions, windows.current)
	const records = records_by_kind(cut)
	const current = cost_audit_session_count.counts_by_kind(cut)
	const previous = cost_audit_session_count.counts_by_kind(inside(input.sessions, windows.previous))

	return rows_of(costs.current.kinds, costs.previous.kinds).map((kind) => ({
		...kind,
		models: cost_audit_spend.spend_of(records.get(kind.key) ?? []),
		sessions: { current: current.get(kind.key) ?? 0, previous: previous.get(kind.key) ?? 0 },
	}))
}

function phases_inside(input: AuditInput, window: AuditWindow): Array<PhaseRow> {
	const breakdowns = input.breakdowns ?? new Map<number, Breakdown>()

	return cost_audit_phase.rows_of({
		sessions: inside(input.sessions, window),
		reviews: input.sessions,
		breakdowns,
	})
}

function resume_review_fix(input: AuditInput, window: AuditWindow): number {
	const resumed = input.sessions.filter((session) => session.kind === cost_audit_kind.RESUME)
	const rows = cost_audit_phase.rows_of({
		sessions: inside(resumed, window),
		reviews: input.sessions,
		breakdowns: input.breakdowns ?? new Map<number, Breakdown>(),
	})

	return rows.find((one) => one.key === cost_audit_phase.REVIEW_FIX_PHASE)?.usd ?? 0
}

function resumes(input: AuditInput, current: AuditWindow, previous: AuditWindow): ResumeBreakdown {
	return {
		triggers: cost_audit_resume.rows_of(
			inside(input.sessions, current),
			inside(input.sessions, previous),
		),
		review_fix: row(
			cost_audit_phase.REVIEW_FIX_PHASE,
			resume_review_fix(input, current),
			resume_review_fix(input, previous),
		),
	}
}

function review_triggers(
	input: AuditInput,
	current: AuditWindow,
	previous: AuditWindow,
): ReviewTriggers {
	return cost_audit_review_trigger.breakdown_of(input.sessions, input.merged_issues, {
		current: (at_ms) => is_inside(at_ms, current),
		previous: (at_ms) => is_inside(at_ms, previous),
	})
}

// The lane-child density of the requests made inside `window`.
function density_inside(sessions: ReadonlyArray<AuditSession>, window: AuditWindow): Density {
	return cost_audit_density.density_of(inside(sessions, window))
}

function lane_density(
	sessions: ReadonlyArray<AuditSession>,
	current: AuditWindow,
	previous: AuditWindow,
): LaneDensity {
	return {
		current: density_inside(sessions, current),
		previous: density_inside(sessions, previous),
	}
}

// The breakdowns read off the current period alone, never set beside the period before.
function current_only(
	input: AuditInput,
	window: AuditWindow,
): Pick<Audit, 'phases' | 'agents' | 'usage' | 'results' | 'sequences'> {
	const cut = inside(input.sessions, window)

	return {
		phases: phases_inside(input, window),
		agents: cost_audit_phase.agent_rows_of(cut),
		usage: cost_audit_usage.breakdown_of(input.sessions, (at_ms) => is_inside(at_ms, window)),
		results: cost_audit_result.breakdown_of(cut),
		sequences: cost_audit_sequence.sequences_of(cut),
	}
}

function audit(input: AuditInput): Audit {
	const [current_window, previous_window] = windows_of(input.days, input.now_ms)
	const current = period_cost(input.sessions, current_window)
	const previous = period_cost(input.sessions, previous_window)

	return {
		...current_only(input, current_window),
		days: input.days,
		lane_density: lane_density(input.sessions, current_window, previous_window),
		total: row('total', current.total, previous.total),
		merges: input.merges,
		per_merge: per_merge(current, previous, input.merges),
		kinds: kind_rows(
			input,
			{ current, previous },
			{ current: current_window, previous: previous_window },
		),
		tools: rows_of(current.tools, previous.tools),
		guards: rows_of(current.guards, previous.guards),
		rewrites: rewrites(input, current_window, previous_window),
		write_causes: write_causes(input.sessions, current_window, previous_window),
		resumes: resumes(input, current_window, previous_window),
		review_triggers: review_triggers(input, current_window, previous_window),
	}
}

// Where the previous period opens — the earliest instant the audit reads.
function since_ms(days: number, now_ms: number): number {
	return windows_of(days, now_ms)[1].start_ms
}

const cost_audit = {
	DEFAULT_PERIOD_DAYS,
	MS_PER_DAY,
	audit,
	density_inside,
	inside,
	since_ms,
	windows_of,
}

export type { Audit, AuditRow, AuditWindow, LaneDensity, MergeCounts, ResumeBreakdown }
export { cost_audit }
