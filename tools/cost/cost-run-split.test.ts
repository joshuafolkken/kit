import type { UsageRecord, UsageTotals } from '#scripts/cost-runtime/cost-usage'
import { describe, expect, it } from 'vitest'
import type { RunNode, RunRole } from './cost-run-nodes'
import { cost_run_split } from './cost-run-split'

const EMPTY: UsageTotals = {
	input_tokens: 0,
	cache_write_5m_tokens: 0,
	cache_write_1h_tokens: 0,
	cache_read_tokens: 0,
	output_tokens: 0,
	thinking_tokens: 0,
	thinking_measured: false,
}

const MINUTE = 60_000
const SPLIT_AT = 100 * MINUTE

function rec(id: string, at_ms: number | undefined): UsageRecord {
	return {
		request_id: id,
		model: 'claude-opus-5',
		branch: 'main',
		at_ms,
		totals: { ...EMPTY, input_tokens: 1000, output_tokens: 100 },
	}
}

// A session of `requests` requests one minute apart, starting at `start_ms`.
function node(id: string, role: RunRole, start_ms: number, requests: number): RunNode {
	const records = Array.from({ length: requests }, (_, index) =>
		rec(`${id}-${String(index)}`, start_ms + index * MINUTE),
	)

	return {
		session_id: id,
		role,
		issue: undefined,
		parent_id: undefined,
		depth: 0,
		modified_ms: 0,
		records,
		baseline_tokens: 100,
		is_readable: true,
		took_cut: false,
	}
}

const NODES: ReadonlyArray<RunNode> = [
	node('w1', 'wake', 0, 9),
	node('L1', 'lane', 10 * MINUTE, 3),
	node('w2', 'wake', SPLIT_AT, 2),
	node('L2', 'lane', SPLIT_AT + MINUTE, 6),
	node('L3', 'lane', SPLIT_AT + 20 * MINUTE, 4),
]

describe('cost_run_split.build', () => {
	const split = cost_run_split.build(NODES, SPLIT_AT)

	it('puts each session on the side of its first request, the instant itself on the after side', () => {
		expect(split.at).toBe(new Date(SPLIT_AT).toISOString())
		expect(split.before.session_count).toBe(2)
		expect(split.after.session_count).toBe(3)
	})

	it('rolls each side up by role against that side alone', () => {
		const wake_before = split.before.roles.find((role) => role.role === 'wake')
		const wake_after = split.after.roles.find((role) => role.role === 'wake')

		expect(wake_before?.elapsed_ms).toBe(8 * MINUTE)
		expect(wake_before?.elapsed_share).toBeCloseTo(0.8)
		expect(wake_after?.elapsed_share).toBeCloseTo(1 / 9)
		expect(wake_after?.request_count).toBe(2)
	})

	it('leaves a session with no stamped request off both sides', () => {
		const unstamped: RunNode = { ...node('x', 'lane', 0, 1), records: [rec('x', undefined)] }
		const with_unstamped = cost_run_split.build([...NODES, unstamped], SPLIT_AT)

		expect(with_unstamped.before.session_count + with_unstamped.after.session_count).toBe(5)
	})
})

describe('cost_run_split.format_lines', () => {
	it('prints both sides and each role as before → after shares and density', () => {
		const text = cost_run_split.format_lines(cost_run_split.build(NODES, SPLIT_AT)).join('\n')

		expect(text).toContain(`Before → after ${new Date(SPLIT_AT).toISOString()}`)
		expect(text).toContain('before   2 session(s) · 10.0 min')
		expect(text).toContain('after    3 session(s) · 9.0 min')
		expect(text).toContain('wake     time 80.0% → 11.1%')
		expect(text).toContain('req/session 9.0 → 2.0')
		expect(text).toContain('req/session 3.0 → 5.0')
	})

	it('prints a dash on the side a role did not run on', () => {
		const lines = cost_run_split.format_lines(
			cost_run_split.build([node('w1', 'wake', 0, 2), node('L2', 'lane', SPLIT_AT, 2)], SPLIT_AT),
		)
		const lane = lines.find((line) => line.trimStart().startsWith('lane'))

		expect(lane).toBe('  lane     time — → 100.0% · cost — → 100.0% · req/session — → 2.0')
	})
})
