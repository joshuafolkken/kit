import type { UsageRecord, UsageTotals } from '#scripts/cost-runtime/cost-usage'
import { describe, expect, it } from 'vitest'
import type { RunNode, RunRole } from './cost-run-nodes'
import { cost_run_phase } from './cost-run-phase'

const EMPTY: UsageTotals = {
	input_tokens: 0,
	cache_write_5m_tokens: 0,
	cache_write_1h_tokens: 0,
	cache_read_tokens: 0,
	output_tokens: 0,
	thinking_tokens: 0,
	thinking_measured: false,
}

function record(request_id: string): UsageRecord {
	return {
		request_id,
		model: 'claude-opus-5',
		branch: 'main',
		at_ms: 0,
		totals: { ...EMPTY, input_tokens: 1000, output_tokens: 100 },
	}
}

function node(session_id: string, role: RunRole, request_count: number, is_ship = false): RunNode {
	return {
		session_id,
		role,
		issue: 5343,
		parent_id: undefined,
		depth: 1,
		modified_ms: 0,
		records: Array.from({ length: request_count }, (_, index) =>
			record(`${session_id}-${String(index)}`),
		),
		baseline_tokens: 0,
		is_readable: true,
		took_cut: false,
		is_ship,
	}
}

describe('cost_run_phase.build', () => {
	it('sums the lane children by phase, leaving every other role out', () => {
		const phases = cost_run_phase.build([
			node('p', 'parent', 5),
			node('L1', 'lane', 3),
			node('L1/agent-1', 'subagent', 4),
			node('L2', 'lane', 2, true),
		])

		expect(phases).toMatchObject([
			{ phase: 'implement', session_count: 1, request_count: 3 },
			{ phase: 'ship', session_count: 1, request_count: 2 },
		])
		expect(phases[1]?.cost_usd).toBeGreaterThan(0)
	})

	it('reports a phase no session worked in as zero', () => {
		expect(cost_run_phase.build([node('L1', 'lane', 3)])[1]).toEqual({
			phase: 'ship',
			session_count: 0,
			request_count: 0,
			cost_usd: 0,
		})
	})
})

describe('cost_run_phase.format_lines', () => {
	it('prints one line per phase with its sessions, requests and cost', () => {
		const phases = cost_run_phase.build([node('L1', 'lane', 3)])
		const lines = cost_run_phase.format_lines(phases)

		expect(lines).toContain('Worker by phase:')
		expect(lines.join('\n')).toMatch(/implement\s+1 session\(s\) · 3 request\(s\) · \$/u)
	})

	it('prints nothing for a run without a lane child', () => {
		const phases = cost_run_phase.build([node('p', 'parent', 5)])

		expect(cost_run_phase.format_lines(phases)).toEqual([])
	})
})
