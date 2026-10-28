import type { SessionFile } from '#scripts/cost-runtime/cost-transcript'
import type { UsageRecord, UsageTotals } from '#scripts/cost-runtime/cost-usage'
import { describe, expect, it } from 'vitest'
import type { LaneMarks, NodeContext } from './cost-run-nodes'
import { cost_run_tree } from './cost-run-tree'

const NO_MARKS: LaneMarks = { took_cut: false, is_ship: false }

const EMPTY: UsageTotals = {
	input_tokens: 0,
	cache_write_5m_tokens: 0,
	cache_write_1h_tokens: 0,
	cache_read_tokens: 0,
	output_tokens: 0,
	thinking_tokens: 0,
	thinking_measured: false,
}

const HOUR_MS = 60 * 60 * 1000
const SUB_PB = 'pb/agent-1'
const SUB_LA = 'La/agent-1'

function rec(at_ms: number): UsageRecord {
	return { request_id: String(at_ms), model: 'claude-opus-5', branch: 'main', at_ms, totals: EMPTY }
}

function sf(
	session_id: string,
	is_delegated: boolean,
	depth: number,
	modified_ms: number,
): SessionFile {
	return { session_id, path: `/p/${session_id}.jsonl`, modified_ms, is_delegated, depth }
}

function context(
	starts: ReadonlyMap<string, number>,
	lanes: ReadonlyMap<string, number>,
): NodeContext {
	return {
		facts: (id) => ({ records: [rec(starts.get(id) ?? 0)], baseline_tokens: 0, is_readable: true }),
		lane_issue: (file) => lanes.get(file.session_id),
		lane_marks: () => NO_MARKS,
	}
}

describe('cost_run_tree.build_tree default', () => {
	// A batch's newest single transcript is a lane child, so the old "newest own file" default answered
	// for one child of the run. The run-tree default takes the whole run instead.
	const files = [sf('p', false, 0, 10), sf('L1', false, 0, 20), sf('L2', false, 0, 99)]
	const ctx = context(
		new Map([
			['p', 100],
			['L1', 200],
			['L2', 300],
		]),
		new Map([
			['L1', 1],
			['L2', 2],
		]),
	)

	it('selects the run rooted at the parent, not the newest lane child', () => {
		const tree = cost_run_tree.build_tree(files, ctx, undefined)
		const roles = tree?.nodes.map((node) => node.role) ?? []

		expect(tree?.nodes).toHaveLength(3)
		expect(roles).toContain('parent')
		expect(roles.filter((role) => role === 'lane')).toHaveLength(2)
	})

	it('claims every transcript, so none is left unattributed', () => {
		expect(cost_run_tree.build_tree(files, ctx, undefined)?.unattributed_count).toBe(0)
	})

	it("carries the selected run's transcript files for a reader of their lines", () => {
		const tree = cost_run_tree.build_tree(files, ctx, undefined)

		expect(tree?.files.map((file) => file.session_id)).toEqual(['p', 'L1', 'L2'])
	})
})

describe('cost_run_tree.build_tree run grouping', () => {
	// Two batches nine hours apart are two runs; the default takes the later, leaving the earlier's
	// transcripts unattributed rather than folding them in.
	const files = [
		sf('pa', false, 0, 5),
		sf('La', false, 0, 6),
		sf('pb', false, 0, 90),
		sf('Lb', false, 0, 95),
		sf(SUB_PB, true, 1, 96),
	]
	const ctx = context(
		new Map([
			['pa', 0],
			['La', 10],
			['pb', 9 * HOUR_MS],
			['Lb', 9 * HOUR_MS + 10],
			[SUB_PB, 9 * HOUR_MS + 20],
		]),
		new Map([
			['La', 1900],
			['Lb', 1930],
		]),
	)

	it('counts the runs and reports the earlier run as unattributed', () => {
		const tree = cost_run_tree.build_tree(files, ctx, undefined)

		expect(tree?.run_count).toBe(2)
		expect(tree?.nodes.map((node) => node.session_id)).toEqual(['pb', 'Lb', SUB_PB])
		expect(tree?.unattributed_count).toBe(2)
	})

	it('selects a named run by its root parent session', () => {
		const tree = cost_run_tree.build_tree(files, ctx, 'pa')

		expect(tree?.nodes.map((node) => node.session_id)).toEqual(['pa', 'La'])
	})
})

describe('cost_run_tree.build_tree across an idle wait', () => {
	// joshuafolkken/kit#3687: a run idles for up to the idle wait and then runs a child before the wake
	// that judges it, so its two mains start ten hours apart while no stretch between them is quiet for
	// longer than the wait.
	it('keeps one run when a child and its judging wake follow the wait', () => {
		const waited = [
			sf('p1', false, 0, HOUR_MS),
			sf('L', false, 0, 10 * HOUR_MS),
			sf('p2', false, 0, 0),
		]
		const starts = new Map([
			['p1', 0],
			['L', 9 * HOUR_MS],
			['p2', 10 * HOUR_MS + 1],
		])
		const tree = cost_run_tree.build_tree(waited, context(starts, new Map([['L', 1]])), undefined)

		expect(tree?.run_count).toBe(1)
		expect(tree?.nodes.map((node) => node.session_id)).toEqual(['p1', 'p2', 'L'])
	})
})

// A context whose sessions carry every write, not only the first — a session continued later.
function written(
	writes: ReadonlyMap<string, ReadonlyArray<number>>,
	lanes: ReadonlyMap<string, number>,
): NodeContext {
	return {
		facts: (id) => ({
			records: (writes.get(id) ?? []).map((at_ms) => rec(at_ms)),
			baseline_tokens: 0,
			is_readable: true,
		}),
		lane_issue: (file) => lanes.get(file.session_id),
		lane_marks: () => NO_MARKS,
	}
}

describe('cost_run_tree.build_tree when an earlier session is written again later', () => {
	// joshuafolkken/kit#3687: the quiet before a main is what was written before it started. A
	// conversation continued the next morning, or a lane still running, is last written after the later
	// main — and that write must not join two runs the store sat quiet between.
	const files = [
		sf('p1', false, 0, 30 * HOUR_MS),
		sf('L', false, 0, 31 * HOUR_MS),
		sf('p2', false, 0, 0),
	]
	const lanes = new Map([['L', 1]])

	it('keeps two runs apart when the earlier parent is continued after the later one starts', () => {
		const writes = new Map([
			['p1', [0, 30 * HOUR_MS]],
			['L', [HOUR_MS, 31 * HOUR_MS]],
			['p2', [10 * HOUR_MS]],
		])

		expect(cost_run_tree.build_tree(files, written(writes, lanes), undefined)?.run_count).toBe(2)
	})

	it('keeps one run when the lane was still writing inside the window before the later parent', () => {
		const writes = new Map([
			['p1', [0, 30 * HOUR_MS]],
			['L', [HOUR_MS, 9 * HOUR_MS, 31 * HOUR_MS]],
			['p2', [10 * HOUR_MS]],
		])

		expect(cost_run_tree.build_tree(files, written(writes, lanes), undefined)?.run_count).toBe(1)
	})
})

describe('cost_run_tree.build_tree without a parent session', () => {
	it('roots the run on its lane sessions when no main-checkout session exists', () => {
		const files = [sf('La', false, 0, 5), sf(SUB_LA, true, 1, 6)]
		const ctx = context(
			new Map([
				['La', 0],
				[SUB_LA, 5],
			]),
			new Map([['La', 1900]]),
		)
		const tree = cost_run_tree.build_tree(files, ctx, undefined)

		expect(tree?.run_count).toBe(1)
		expect(tree?.nodes.map((node) => node.role)).toEqual(['lane', 'subagent'])
	})
})

describe('cost_run_tree.lane_issue_of', () => {
	const root = '/home/.claude/projects'
	const prefix = 'kit-lanes-'

	it('reads the issue from a lane project slug', () => {
		const file = sf('s', false, 0, 0)
		const lane = { ...file, path: `${root}/kit-lanes-1913/s.jsonl` }

		expect(cost_run_tree.lane_issue_of(lane, root, prefix)).toBe(1913)
	})

	it('is not a lane when the slug does not match or is not all digits', () => {
		const main = { ...sf('s', false, 0, 0), path: `${root}/kit/s.jsonl` }
		const sibling = { ...sf('s', false, 0, 0), path: `${root}/kit-lanes-backup/s.jsonl` }

		expect(cost_run_tree.lane_issue_of(main, root, prefix)).toBeUndefined()
		expect(cost_run_tree.lane_issue_of(sibling, root, prefix)).toBeUndefined()
	})
})
