import { cost_usage, type UsageRecord } from '#scripts/cost-runtime/cost-usage'
import { lane_breakdown, type Breakdown } from '#scripts/lane/lane-breakdown'
import { describe, expect, it } from 'vitest'
import { cost_audit_fixture } from './cost-audit-fixture'
import { cost_audit_phase } from './cost-audit-phase'
import type { AuditSession } from './cost-audit-read'
import { cost_audit_spend } from './cost-audit-spend'
import type { ToolCategory } from './cost-audit-tool'

// joshuafolkken/kit#5936: a lane request's tokens go to the phase its instant fell in, by the stage
// spans `lane_breakdown` cuts, so a change aimed at one phase reads against that phase's figure.

const { ms, record, session } = cost_audit_fixture

const ISSUE = 7
const NO_BREAKDOWN_ISSUE = 8
const SHIP_GATE = 'ship gate'
const FULLRUN = 'fullrun'
const REVIEW_FIX = 'implement: review-fix'
const IMPLEMENT_EDIT = 'implement: edit'
const REVIEWER_ROW = 'subagent: reviewer'

function span(from: number, to: number): { from_ms: number; to_ms: number } {
	return { from_ms: ms(from), to_ms: ms(to) }
}

// Plan to minute 10, the implementation to 60, the ship gate to 70 and round 2 to 80.
const BREAKDOWN: Breakdown = {
	stages: [],
	excluded_ms: 0,
	slept_ms: 0,
	yield_ms: 0,
	waits: [],
	plan: [span(0, 10)],
	implement: [span(10, 60)],
	pre_detach: [],
	ship: [
		{ stage: SHIP_GATE, ...span(60, 70) },
		{ stage: lane_breakdown.ROUND_TWO_STAGE, ...span(70, 80) },
	],
}

function lane_session(
	kind: string,
	records: ReadonlyArray<UsageRecord>,
	categories: ReadonlyArray<readonly [string, ReadonlyArray<ToolCategory>]> = [],
	issue: number | undefined = ISSUE,
): AuditSession {
	return { ...session(kind, records, categories, true), issue }
}

const SEARCH: ReadonlyArray<ToolCategory> = ['code search']

const CHILD = lane_session(
	FULLRUN,
	[
		record('plan', 5, 1),
		record('read', 20, 2),
		record('check', 25, 3),
		record('edit', 30, 4),
		record('fix', 50, 5),
		record('gate', 65, 6),
		record('late', 90, 7),
	],
	[
		['read', SEARCH],
		['check', ['verification', 'edit']],
		['fix', SEARCH],
	],
)
const REVIEW = lane_session('review', [record('round-1', 40, 8), record('round-2', 75, 9)])
const UNMERGED = lane_session(FULLRUN, [record('unmerged', 20, 10)], [], NO_BREAKDOWN_ISSUE)
const OUTSIDE = session(FULLRUN, [record('main', 20, 11)])

// The ship's own order: round 1 inside `ship review` to minute 65, a stopped ship's fix between ship
// stages to 75, then round 2 to 80.
const SHIP_BREAKDOWN: Breakdown = {
	...BREAKDOWN,
	ship: [
		{ stage: 'ship review', ...span(60, 65) },
		{ stage: lane_breakdown.BETWEEN_STAGE, ...span(65, 75) },
		{ stage: lane_breakdown.ROUND_TWO_STAGE, ...span(75, 80) },
	],
}

interface CostsInput {
	sessions: ReadonlyArray<AuditSession>
	reviews?: ReadonlyArray<AuditSession>
	breakdown?: Breakdown
}

function costs_of(input: CostsInput): Array<readonly [string, number]> {
	const { sessions, reviews = sessions, breakdown = BREAKDOWN } = input
	const rows = cost_audit_phase.rows_of({
		sessions,
		reviews,
		breakdowns: new Map([[ISSUE, breakdown]]),
	})

	return rows.map((row) => [row.key, row.usd] as const)
}

describe('cost_audit_phase.rows_of — a lane request placed by its stage', () => {
	it('places each request of a fixed lane transcript in its phase, the costliest first', () => {
		expect(costs_of({ sessions: [CHILD, REVIEW, UNMERGED, OUTSIDE] })).toStrictEqual([
			[cost_audit_phase.UNATTRIBUTED, 17],
			[cost_audit_phase.ROUND_TWO, 9],
			[cost_audit_phase.ROUND_ONE, 8],
			[SHIP_GATE, 6],
			[REVIEW_FIX, 5],
			[IMPLEMENT_EDIT, 4],
			['implement: check', 3],
			['implement: read', 2],
			[cost_audit_phase.PLAN, 1],
		])
	})

	it('sums the four token kinds, both cache writes as one', () => {
		const totals = {
			...cost_usage.EMPTY_TOTALS,
			input_tokens: 1,
			cache_read_tokens: 2,
			cache_write_5m_tokens: 3,
			cache_write_1h_tokens: 4,
			output_tokens: 5,
		}
		const sessions = [lane_session(FULLRUN, [{ ...record('plan', 5, 0), totals }])]
		const [row] = cost_audit_phase.rows_of({
			sessions,
			reviews: sessions,
			breakdowns: new Map([[ISSUE, BREAKDOWN]]),
		})

		expect(row?.tokens).toStrictEqual({ input: 1, cache_read: 2, cache_write: 7, output: 5 })
	})
})

// joshuafolkken/kit#6899: each row carries its dollars by model and token type, summing to its cost.
describe('cost_audit_phase.rows_of — the per-model breakdown', () => {
	it("breaks each row's cost down by model, the terms summing to the row's cost", () => {
		const rows = cost_audit_phase.rows_of({
			sessions: [CHILD, REVIEW, UNMERGED, OUTSIDE],
			reviews: [CHILD, REVIEW, UNMERGED, OUTSIDE],
			breakdowns: new Map([[ISSUE, BREAKDOWN]]),
		})

		for (const row of rows) {
			const sum = row.models.reduce((total, spend) => total + cost_audit_spend.total_of(spend), 0)

			expect(row.models.map((spend) => spend.model)).toStrictEqual(['claude-haiku-4-5'])
			expect(sum).toBeCloseTo(row.usd)
		}
	})
})

describe('cost_audit_phase.rows_of — the fix of a review that ran inside the ship', () => {
	it('counts a request between ship stages after round 1 as the review fix', () => {
		const child = lane_session(FULLRUN, [record('edit', 30, 4), record('fix', 70, 5)])
		const review = lane_session('review', [record('round-1', 62, 8), record('round-2', 77, 9)])

		expect(costs_of({ sessions: [child, review], breakdown: SHIP_BREAKDOWN })).toStrictEqual([
			[cost_audit_phase.ROUND_TWO, 9],
			[cost_audit_phase.ROUND_ONE, 8],
			[REVIEW_FIX, 5],
			[IMPLEMENT_EDIT, 4],
		])
	})

	it('keeps a request between ship stages before any review as that stage', () => {
		const child = lane_session(FULLRUN, [record('wait', 70, 5)])

		expect(costs_of({ sessions: [child], breakdown: SHIP_BREAKDOWN })).toStrictEqual([
			[lane_breakdown.BETWEEN_STAGE, 5],
		])
	})

	it('reads the first review from every session, not only the windowed ones', () => {
		const child = lane_session(FULLRUN, [record('fix', 50, 5)])

		expect(costs_of({ sessions: [child], reviews: [child, REVIEW] })).toStrictEqual([
			[REVIEW_FIX, 5],
		])
	})
})

// joshuafolkken/kit#5971: a lane's delegated units by the agent type their `meta.json` names.
function unit(
	kind: string,
	records: ReadonlyArray<UsageRecord>,
	agent_type?: string,
): AuditSession {
	return { ...session(kind, records), issue: ISSUE, agent_type }
}

describe('cost_audit_phase.agent_rows_of — a lane subagent by its agent type', () => {
	it('sums each agent type into one row and keeps a unit with no meta.json under its kind', () => {
		const sessions = [
			unit('review', [record('r1', 5, 2)], 'reviewer'),
			unit('subagent', [record('i1', 6, 3)], 'investigator'),
			unit('review', [record('r2', 7, 4)], 'reviewer'),
			unit('subagent', [record('u1', 8, 1)]),
		]
		const rows = cost_audit_phase.agent_rows_of(sessions).map((row) => [row.key, row.usd])

		expect(rows).toStrictEqual([
			[REVIEWER_ROW, 6],
			['subagent: investigator', 3],
			['subagent', 1],
		])
	})

	it("leaves out the lane child's own session and a unit outside every lane", () => {
		const outside = { ...session('subagent', [record('o1', 5, 2)]), agent_type: 'reviewer' }
		const sessions = [CHILD, outside]

		expect(cost_audit_phase.agent_rows_of(sessions)).toStrictEqual([])
	})
})

// joshuafolkken/kit#7045: each row counts its requests whose output passed `LONG_OUTPUT_TOKENS`.
function with_output(base: UsageRecord, output_tokens: number): UsageRecord {
	return { ...base, totals: { ...base.totals, output_tokens } }
}

describe('cost_audit_phase — the long-output calls of a row', () => {
	it('counts only the requests whose output passed 2000 tokens, by phase', () => {
		const records = [
			with_output(record('long', 5, 1), 2001),
			with_output(record('edge', 6, 1), 2000),
			with_output(record('short', 7, 1), 10),
		]
		const sessions = [lane_session(FULLRUN, records)]
		const [row] = cost_audit_phase.rows_of({
			sessions,
			reviews: sessions,
			breakdowns: new Map([[ISSUE, BREAKDOWN]]),
		})

		expect([row?.key, row?.long_calls]).toStrictEqual([cost_audit_phase.PLAN, 1])
	})

	it('counts them by agent type', () => {
		const sessions = [
			unit('review', [with_output(record('r1', 5, 2), 4000)], 'reviewer'),
			unit('review', [with_output(record('r2', 7, 4), 3000)], 'reviewer'),
		]
		const rows = cost_audit_phase.agent_rows_of(sessions).map((row) => [row.key, row.long_calls])

		expect(rows).toStrictEqual([[REVIEWER_ROW, 2]])
	})
})
