import { describe, expect, it } from 'vitest'
import { cost_run_nodes, type NodeContext, type RunNode } from './cost-run-nodes'
import type { SessionFile } from './cost-transcript'
import type { UsageRecord, UsageTotals } from './cost-usage'

// Roles are not written to any transcript, so the classification is driven here by fabricated files
// and a literal context — the same shape `cost-run-tree.ts` feeds it from the filesystem
// (joshuafolkken/kit#1937).

const EMPTY: UsageTotals = {
	input_tokens: 0,
	cache_write_5m_tokens: 0,
	cache_write_1h_tokens: 0,
	cache_read_tokens: 0,
	output_tokens: 0,
	thinking_tokens: 0,
	thinking_measured: false,
}

const MAIN = 'main'
const LANE_1913 = '1913-lane'
const SUB_2 = 'p/agent-1/agent-2'
const SUB_LANE = 'L1/agent-x'

function rec(branch: string, at_ms: number): UsageRecord {
	return {
		request_id: `${branch}-${String(at_ms)}`,
		model: 'claude-opus-5',
		branch,
		at_ms,
		totals: { ...EMPTY, input_tokens: 100, output_tokens: 10 },
	}
}

function sf(session_id: string, is_delegated: boolean, depth: number): SessionFile {
	return { session_id, path: `/p/${session_id}.jsonl`, modified_ms: 0, is_delegated, depth }
}

const LANES = new Map([
	['L1', 1913],
	['L2', 1930],
])

const FACTS = new Map([
	['p', [rec(MAIN, 100)]],
	['p2', [rec(MAIN, 900)]],
	['L1', [rec(LANE_1913, 200)]],
	['L2', [rec('1930-lane', 300)]],
	['p/agent-1', [rec(MAIN, 210)]],
	[SUB_2, [rec(MAIN, 215)]],
	[SUB_LANE, [rec(LANE_1913, 220)]],
])

const CONTEXT: NodeContext = {
	facts: (id) => ({ records: FACTS.get(id) ?? [], baseline_tokens: 100, is_readable: true }),
	lane_issue: (file) => LANES.get(file.session_id),
}

// The acceptance tree: a parent, its wake/resume, two lane children, a subagent of the parent, a
// subagent of a lane child, and a subagent that subagent spawned.
const FILES: ReadonlyArray<SessionFile> = [
	sf('p', false, 0),
	sf('p2', false, 0),
	sf('L1', false, 0),
	sf('L2', false, 0),
	sf('p/agent-1', true, 1),
	sf(SUB_2, true, 2),
	sf(SUB_LANE, true, 1),
]

function by_id(): Map<string, RunNode> {
	return new Map(cost_run_nodes.build_nodes(FILES, CONTEXT).map((node) => [node.session_id, node]))
}

describe('cost_run_nodes.build_nodes', () => {
	it('names the earliest main-checkout session the parent and the rest wakes', () => {
		const nodes = by_id()

		expect(nodes.get('p')).toMatchObject({ role: 'parent', depth: 0, parent_id: undefined })
		expect(nodes.get('p2')).toMatchObject({ role: 'wake', depth: 0, parent_id: 'p' })
	})

	it('reads a lane child from its slug, at depth 1 under the parent', () => {
		const nodes = by_id()

		expect(nodes.get('L1')).toMatchObject({ role: 'lane', depth: 1, issue: 1913, parent_id: 'p' })
		expect(nodes.get('L2')).toMatchObject({ role: 'lane', depth: 1, issue: 1930, parent_id: 'p' })
	})

	it('depths a subagent from the root parent and links it to its immediate spawner', () => {
		const nodes = by_id()

		expect(nodes.get('p/agent-1')).toMatchObject({ role: 'subagent', depth: 1, parent_id: 'p' })
	})

	it('carries a nested subagent to depth 2 with the depth-1 unit as its parent', () => {
		const nodes = by_id()

		expect(nodes.get(SUB_2)).toMatchObject({
			role: 'subagent',
			depth: 2,
			parent_id: 'p/agent-1',
		})
	})

	it("counts a lane child's subagent from the lane's own depth", () => {
		const nodes = by_id()

		expect(nodes.get(SUB_LANE)).toMatchObject({ role: 'subagent', depth: 2, parent_id: 'L1' })
	})
})

describe('cost_run_nodes.issue_from_branch', () => {
	it('reads the leading issue number, and nothing from a branch without one', () => {
		expect(cost_run_nodes.issue_from_branch('1937-lane')).toBe(1937)
		expect(cost_run_nodes.issue_from_branch('1937-add-a-scope')).toBe(1937)
		expect(cost_run_nodes.issue_from_branch('main')).toBeUndefined()
	})
})
