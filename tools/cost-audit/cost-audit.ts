import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import type { UsageRecord } from '#scripts/cost-runtime/cost-usage'
import type { Breakdown } from '#scripts/lane/lane-breakdown'
import { guard_friction } from '#tools/retrospective/guard-friction'
import { cost_audit_density, type Density } from './cost-audit-density'
import { cost_audit_phase, type PhaseRow } from './cost-audit-phase'
import type { AuditSession } from './cost-audit-read'
import { cost_audit_result, type ResultBreakdown } from './cost-audit-result'
import { cost_audit_rewrite, type Rewrites } from './cost-audit-rewrite'
import { cost_audit_spend, type ModelSpend } from './cost-audit-spend'
import { cost_audit_tool } from './cost-audit-tool'
import { cost_audit_usage, type UsageBreakdown } from './cost-audit-usage'

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
	rewrites: { current: Rewrites; previous: Rewrites }
	// The current period's lane requests by phase (joshuafolkken/kit#5936).
	phases: ReadonlyArray<PhaseRow>
	// The current period's lane delegated units by agent type (joshuafolkken/kit#5971).
	agents: ReadonlyArray<PhaseRow>
	// The current period's usage breakdown (joshuafolkken/kit#7042).
	usage: UsageBreakdown
	// The current period's cost by effort and tool-result characters (joshuafolkken/kit#7055).
	results: ResultBreakdown
}

interface AuditInput {
	sessions: ReadonlyArray<AuditSession>
	days: number
	now_ms: number
	merges: MergeCounts | undefined
	// Each lane's stages by its Issue, for the phase table; absent, every lane request is unattributed.
	breakdowns?: ReadonlyMap<number, Breakdown>
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

function records_by_kind(sessions: ReadonlyArray<AuditSession>): Map<string, Array<UsageRecord>> {
	const records = new Map<string, Array<UsageRecord>>()

	for (const session of sessions) {
		records.set(session.kind, [...(records.get(session.kind) ?? []), ...session.records])
	}

	return records
}

// The kind rows, each carrying its current-period requests' spend per model and token type.
function kind_rows(
	current: PeriodCost,
	previous: PeriodCost,
	cut: ReadonlyArray<AuditSession>,
): Array<AuditRow> {
	const records = records_by_kind(cut)

	return rows_of(current.kinds, previous.kinds).map((kind) => ({
		...kind,
		models: cost_audit_spend.spend_of(records.get(kind.key) ?? []),
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

function lane_density(
	sessions: ReadonlyArray<AuditSession>,
	current: AuditWindow,
	previous: AuditWindow,
): LaneDensity {
	return {
		current: cost_audit_density.density_of(inside(sessions, current)),
		previous: cost_audit_density.density_of(inside(sessions, previous)),
	}
}

function audit(input: AuditInput): Audit {
	const [current_window, previous_window] = windows_of(input.days, input.now_ms)
	const current = period_cost(input.sessions, current_window)
	const previous = period_cost(input.sessions, previous_window)

	return {
		days: input.days,
		lane_density: lane_density(input.sessions, current_window, previous_window),
		total: row('total', current.total, previous.total),
		merges: input.merges,
		per_merge: per_merge(current, previous, input.merges),
		kinds: kind_rows(current, previous, inside(input.sessions, current_window)),
		tools: rows_of(current.tools, previous.tools),
		guards: rows_of(current.guards, previous.guards),
		rewrites: {
			current: rewrites_inside(input.sessions, current_window),
			previous: rewrites_inside(input.sessions, previous_window),
		},
		phases: phases_inside(input, current_window),
		agents: cost_audit_phase.agent_rows_of(inside(input.sessions, current_window)),
		usage: cost_audit_usage.breakdown_of(input.sessions, (at_ms) =>
			is_inside(at_ms, current_window),
		),
		results: cost_audit_result.breakdown_of(inside(input.sessions, current_window)),
	}
}

// Where the previous period opens — the earliest instant the audit reads.
function since_ms(days: number, now_ms: number): number {
	return windows_of(days, now_ms)[1].start_ms
}

const cost_audit = { DEFAULT_PERIOD_DAYS, MS_PER_DAY, audit, since_ms, windows_of }

export type { Audit, AuditRow, AuditWindow, LaneDensity, MergeCounts }
export { cost_audit }
