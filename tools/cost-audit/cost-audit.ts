import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import type { UsageRecord } from '#scripts/cost-runtime/cost-usage'
import { guard_friction } from '#tools/retrospective/guard-friction'
import { cost_audit_density, type Density } from './cost-audit-density'
import type { AuditSession } from './cost-audit-read'
import { cost_audit_tool } from './cost-audit-tool'

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
}

interface AuditInput {
	sessions: ReadonlyArray<AuditSession>
	days: number
	now_ms: number
	merges: MergeCounts | undefined
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

function audit(input: AuditInput): Audit {
	const [current_window, previous_window] = windows_of(input.days, input.now_ms)
	const current = period_cost(input.sessions, current_window)
	const previous = period_cost(input.sessions, previous_window)

	return {
		days: input.days,
		lane_density: {
			current: cost_audit_density.density_of(inside(input.sessions, current_window)),
			previous: cost_audit_density.density_of(inside(input.sessions, previous_window)),
		},
		total: row('total', current.total, previous.total),
		merges: input.merges,
		per_merge: per_merge(current, previous, input.merges),
		kinds: rows_of(current.kinds, previous.kinds),
		tools: rows_of(current.tools, previous.tools),
		guards: rows_of(current.guards, previous.guards),
	}
}

// Where the previous period opens — the earliest instant the audit reads.
function since_ms(days: number, now_ms: number): number {
	return windows_of(days, now_ms)[1].start_ms
}

const cost_audit = { DEFAULT_PERIOD_DAYS, audit, since_ms, windows_of }

export type { Audit, AuditRow, AuditWindow, LaneDensity, MergeCounts }
export { cost_audit }
