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
})
