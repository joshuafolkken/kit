import type { UsageRecord, UsageTotals } from '#scripts/cost-runtime/cost-usage'
import { describe, expect, it } from 'vitest'
import type { RunNode, RunRole } from './cost-run-nodes'
import { cost_run_report } from './cost-run-report'

const EMPTY: UsageTotals = {
	input_tokens: 0,
	cache_write_5m_tokens: 0,
	cache_write_1h_tokens: 0,
	cache_read_tokens: 0,
	output_tokens: 0,
	thinking_tokens: 0,
	thinking_measured: false,
}

function node(
	session_id: string,
	role: RunRole,
	issue: number | undefined,
	depth: number,
): RunNode {
	const record: UsageRecord = {
		request_id: session_id,
		model: 'claude-opus-5',
		branch: 'main',
		at_ms: 0,
		totals: { ...EMPTY, input_tokens: 1000, output_tokens: 100 },
	}

	return {
		session_id,
		role,
		issue,
		parent_id: undefined,
		depth,
		modified_ms: 0,
		records: [record],
		baseline_tokens: 100,
		is_readable: true,
	}
}

const NODES: ReadonlyArray<RunNode> = [
	node('p', 'parent', undefined, 0),
	node('L1', 'lane', 1913, 1),
]

describe('cost_run_report.build', () => {
	it('carries the run and unattributed counts, and leaves merges not measured', () => {
		const report = cost_run_report.build(2, 3, NODES)

		expect(report.run_count).toBe(2)
		expect(report.unattributed_count).toBe(3)
		expect(report.merged).toBeUndefined()
		expect(report.session_count).toBe(2)
	})

	it('serializes session output tokens in JSON', () => {
		const report = cost_run_report.build(1, 0, NODES)

		expect(JSON.stringify(report)).toContain('"output_tokens":100')
		expect(JSON.stringify(report)).toContain('"is_readable":true')
		expect(JSON.stringify(report)).toContain('"is_measured":true')
	})
})

describe('cost_run_report.format_report', () => {
	const text = cost_run_report.format_report(cost_run_report.build(1, 0, NODES))

	it('leads with the run tree and its store counts', () => {
		expect(text).toContain('run tree')
		expect(text).toContain('runs in store: 1')
		expect(text).toContain(`merges: ${cost_run_report.NOT_MEASURED}`)
	})

	it('breaks the run down by role and lists the sessions with depth and issue', () => {
		expect(text).toContain('By role')
		expect(text).toContain('Sessions')
		expect(text).toContain('#1913')
		expect(text).toContain('d1')
		expect(text).toContain('output 100')
	})
})

describe('cost_run_report.format_report missing measurements', () => {
	it('marks an unreadable session as not measured', () => {
		const unreadable = {
			...node('broken', 'lane', 1913, 1),
			records: [],
			is_readable: false,
		}
		const unreadable_text = cost_run_report.format_report(cost_run_report.build(1, 0, [unreadable]))

		expect(unreadable_text).toContain('broken  not measured')
		expect(unreadable_text).not.toContain('output 0')
		expect(JSON.stringify(cost_run_report.build(1, 0, [unreadable]))).toContain(
			'"is_readable":false',
		)
	})

	it('marks a readable session without usage records as not measured', () => {
		const empty = {
			...node('readable-empty', 'lane', 1913, 1),
			records: [],
			is_readable: true,
		}
		const report = cost_run_report.build(1, 0, [empty])

		expect(cost_run_report.format_report(report)).toContain('readable-empty  not measured')
		expect(report.sessions[0]).toMatchObject({ is_readable: true, is_measured: false })
	})
})
