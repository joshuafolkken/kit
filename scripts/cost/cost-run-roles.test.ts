import type { UsageRecord, UsageTotals } from '#scripts/cost-runtime/cost-usage'
import { describe, expect, it } from 'vitest'
import type { RunNode, RunRole } from './cost-run-nodes'
import { cost_run_roles } from './cost-run-roles'

const EMPTY: UsageTotals = {
	input_tokens: 0,
	cache_write_5m_tokens: 0,
	cache_write_1h_tokens: 0,
	cache_read_tokens: 0,
	output_tokens: 0,
	thinking_tokens: 0,
	thinking_measured: false,
}

const SHARE_EPSILON = 1e-9
const READABLE_EMPTY = 'readable-empty'

function rec(id: string, output: number): UsageRecord {
	return {
		request_id: id,
		model: 'claude-opus-5',
		branch: 'main',
		at_ms: 0,
		totals: { ...EMPTY, input_tokens: 1000, output_tokens: output },
	}
}

function node(session_id: string, role: RunRole, output: number | undefined): RunNode {
	return {
		session_id,
		role,
		issue: undefined,
		parent_id: undefined,
		depth: 0,
		modified_ms: 0,
		records: output === undefined ? [] : [rec(session_id, output)],
		baseline_tokens: 100,
		is_readable: output !== undefined,
	}
}

const NODES: ReadonlyArray<RunNode> = [
	node('p', 'parent', 100),
	node('L1', 'lane', 300),
	node('L2', 'lane', 200),
	node('s', 'subagent', 50),
	node('broken', 'wake', undefined),
]

describe('cost_run_roles.build', () => {
	it('sums a role across its sessions', () => {
		const lane = cost_run_roles.build(NODES).roles.find((role) => role.role === 'lane')

		expect(lane?.session_count).toBe(2)
		expect(lane?.request_count).toBe(2)
		expect(lane?.preamble_tokens).toBe(200)
	})

	it('gives shares that sum to the whole', () => {
		const { roles } = cost_run_roles.build(NODES)

		expect(cost_run_roles.shares_total(roles)).toBeCloseTo(cost_run_roles.WHOLE, SHARE_EPSILON)
	})

	it('reports an unreadable session as a count, and it adds nothing to the shares', () => {
		const result = cost_run_roles.build(NODES)
		const wake = result.roles.find((role) => role.role === 'wake')

		expect(result.unreadable_count).toBe(1)
		expect(wake?.cost_usd).toBe(0)
		expect(wake?.cost_share).toBe(0)
	})

	it('orders the session rows cost-heaviest first', () => {
		const rows = cost_run_roles.build(NODES).sessions

		expect(rows[0]?.session_id).toBe('L1')
		expect(rows.map((row) => row.cost_usd)).toEqual(
			rows.map((row) => row.cost_usd).toSorted((left, right) => right - left),
		)
	})

	it('reports output tokens for each session', () => {
		const lane = node('L3', 'lane', undefined)

		lane.records = [rec('first', 100), rec('second', 200)]
		const rows = cost_run_roles.build([...NODES, lane]).sessions

		expect(rows.find((row) => row.session_id === 'L3')?.output_tokens).toBe(300)
		expect(rows.find((row) => row.session_id === 'broken')?.output_tokens).toBe(0)
	})
})

describe('cost_run_roles.measure_lane_issue', () => {
	it('sums every lane session for an issue', () => {
		const first = {
			...node('first', 'lane', 100),
			issue: 2076,
			records: [
				{ ...rec('first-a', 40), at_ms: 100 },
				{ ...rec('first-b', 60), at_ms: 250 },
			],
		}
		const resumed = {
			...node('resumed', 'lane', 200),
			issue: 2076,
			records: [
				{ ...rec('resumed-a', 80), at_ms: 500 },
				{ ...rec('resumed-b', 120), at_ms: 750 },
			],
		}
		const rows = cost_run_roles.build([first, resumed]).sessions
		const expected_cost = rows.reduce((total, row) => total + row.cost_usd, 0)

		expect(cost_run_roles.measure_lane_issue(rows, 2076)).toEqual({
			output_tokens: 300,
			cost_usd: expected_cost,
			elapsed_ms: 400,
		})
	})
})

describe('cost_run_roles.measure_lane_issue missing measurements', () => {
	it('does not measure an issue when any matching lane session is unreadable', () => {
		const readable = { ...node('readable', 'lane', 100), issue: 2076 }
		const unreadable = { ...node('unreadable', 'lane', undefined), issue: 2076 }
		const rows = cost_run_roles.build([readable, unreadable]).sessions

		expect(cost_run_roles.measure_lane_issue(rows, 2076)).toBeUndefined()
		expect(cost_run_roles.measure_lane_issue(rows, 9999)).toBeUndefined()
	})

	it('does not measure a readable session without usage records', () => {
		const measured = { ...node('measured', 'lane', 100), issue: 2076 }
		const empty = {
			...node(READABLE_EMPTY, 'lane', undefined),
			issue: 2076,
			is_readable: true,
		}
		const rows = cost_run_roles.build([measured, empty]).sessions
		const empty_row = rows.find((row) => row.session_id === READABLE_EMPTY)

		expect(empty_row).toMatchObject({ is_readable: true, is_measured: false })
		expect(cost_run_roles.measure_lane_issue(rows, 2076)).toBeUndefined()
	})
})
