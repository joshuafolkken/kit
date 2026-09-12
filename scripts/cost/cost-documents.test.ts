import { describe, expect, it } from 'vitest'
import { cost_documents } from './cost-documents'
import type { UsageRecord, UsageTotals } from './cost-usage'

const EMPTY_TOTALS: UsageTotals = {
	input_tokens: 0,
	cache_write_5m_tokens: 0,
	cache_write_1h_tokens: 0,
	cache_read_tokens: 0,
	output_tokens: 0,
	thinking_tokens: 0,
}

const MODEL = 'claude-opus-4-8'
const SKILL = '/repo/.claude/skills/workflow-commands/SKILL.md'
const REVIEW = '/repo/prompts/review.md'
const ROOT = '/repo/CLAUDE.md'
const SOURCE = '/repo/scripts/cost/cost-cli.ts'
const OTHER_MD = '/repo/docs/guide.md'
const SKILL_SHORT = '.claude/skills/workflow-commands/SKILL.md'
const REVIEW_SHORT = 'prompts/review.md'

function records(count: number): Array<UsageRecord> {
	return Array.from({ length: count }, (_, index) => ({
		request_id: `req_${String(index + 1)}`,
		model: MODEL,
		branch: 'main',
		at_ms: index,
		totals: EMPTY_TOTALS,
	}))
}

function read_line(request_id: string, tool_use_id: string, file_path: string): string {
	return JSON.stringify({
		type: 'assistant',
		requestId: request_id,
		message: {
			model: MODEL,
			usage: { input_tokens: 1 },
			content: [{ type: 'tool_use', name: 'Read', id: tool_use_id, input: { file_path } }],
		},
	})
}

function result_line(tool_use_id: string, content: string): string {
	return JSON.stringify({
		type: 'user',
		message: { content: [{ type: 'tool_result', tool_use_id, content }] },
	})
}

function plain_line(request_id: string): string {
	return JSON.stringify({
		type: 'assistant',
		requestId: request_id,
		message: { model: MODEL, usage: { input_tokens: 1 }, content: [{ type: 'text', text: 'ok' }] },
	})
}

// SKILL read at request 1 of 5 → carried 4; review at request 3 → carried 2; the source file and the
// out-of-root markdown are both ignored.
const RAW = [
	read_line('req_1', 'tu_1', SKILL),
	result_line('tu_1', 'x'.repeat(300)),
	read_line('req_2', 'tu_2', SOURCE),
	result_line('tu_2', 'y'.repeat(30)),
	read_line('req_3', 'tu_3', REVIEW),
	result_line('tu_3', 'z'.repeat(150)),
	read_line('req_4', 'tu_4', OTHER_MD),
	result_line('tu_4', 'w'.repeat(60)),
	plain_line('req_5'),
].join('\n')

describe('cost_documents.build — detection and measurement', () => {
	it('keeps one row per entry-read document, largest carry cost first', () => {
		const breakdown = cost_documents.build([{ raw: RAW, records: records(5) }])

		expect(breakdown.rows.map((row) => row.path)).toEqual([SKILL_SHORT, REVIEW_SHORT])
	})

	it('measures tokens from the result and carries them over the following requests', () => {
		const [skill] = cost_documents.build([{ raw: RAW, records: records(5) }]).rows

		expect(skill?.tokens).toBe(100)
		expect(skill?.carried_requests).toBe(4)
		expect(skill?.is_measured).toBe(true)
		expect(skill?.cost_usd).toBeCloseTo(0.0002)
	})

	it('prices the carry at the cache-read rate of the session model', () => {
		const review = cost_documents
			.build([{ raw: RAW, records: records(5) }])
			.rows.find((row) => row.path === REVIEW_SHORT)

		expect(review?.carried_requests).toBe(2)
		expect(review?.cost_usd).toBeCloseTo(0.00005)
	})
})

describe('cost_documents.build — unmeasured, roots and merging', () => {
	it('marks a read whose result is absent as unmeasured, never zero cost', () => {
		const raw = [read_line('req_1', 'tu_1', SKILL), plain_line('req_2')].join('\n')

		const [row] = cost_documents.build([{ raw, records: records(2) }]).rows

		expect(row?.is_measured).toBe(false)
		expect(row?.tokens).toBe(0)
		expect(row?.carried_requests).toBe(1)
	})

	it('shortens a root agent document to its basename', () => {
		const raw = [read_line('req_1', 'tu_1', ROOT), result_line('tu_1', 'a'.repeat(30))].join('\n')

		const [row] = cost_documents.build([{ raw, records: records(1) }]).rows

		expect(row?.path).toBe('CLAUDE.md')
	})

	it('merges the same document read across sessions, adding carry and cost', () => {
		const [merged] = cost_documents.build([
			{ raw: RAW, records: records(5) },
			{ raw: RAW, records: records(5) },
		]).rows

		expect(merged?.carried_requests).toBe(8)
		expect(merged?.cost_usd).toBeCloseTo(0.0004)
	})

	it('returns an empty breakdown for no sources', () => {
		expect(cost_documents.build([])).toEqual({ rows: [], total_cost_usd: 0 })
	})
})

const FORK_PARENT = [
	read_line('req_1', 'tu_1', SKILL),
	result_line('tu_1', 'x'.repeat(300)),
	plain_line('req_2'),
	plain_line('req_3'),
].join('\n')

// The parent's read line copied into the fork, then two extra requests after it.
const FORK_COPIED = [FORK_PARENT, plain_line('req_4'), plain_line('req_5')].join('\n')

// The copied read line, then the same document read again inside the fork.
const FORK_REREAD = [
	FORK_PARENT,
	read_line('req_4', 'tu_4', SKILL),
	result_line('tu_4', 'x'.repeat(300)),
	plain_line('req_5'),
].join('\n')

const PARENT_SCOPE = new Set(['req_1', 'req_2', 'req_3'])
const FORK_SCOPE = new Set(['req_4', 'req_5'])

describe('cost_documents.build — resumed and forked sessions', () => {
	// A read copied into a resumed session's transcript carries only that session's own requests, so
	// the merged carry is the union of the two disjoint scopes, not a double count.
	it('counts a copied read once as the union of the two sessions', () => {
		const [skill] = cost_documents.build([
			{ raw: FORK_PARENT, records: records(3), scope_ids: PARENT_SCOPE },
			{ raw: FORK_COPIED, records: records(5), scope_ids: FORK_SCOPE },
		]).rows

		expect(skill?.carried_requests).toBe(4)
	})

	// A document re-read in the forked session, whose first read was copied in too, is one continuous
	// presence: the forked session's post-read requests are counted once, not twice.
	it('does not double-count a document re-read in the forked session', () => {
		const [skill] = cost_documents.build([
			{ raw: FORK_PARENT, records: records(3), scope_ids: PARENT_SCOPE },
			{ raw: FORK_REREAD, records: records(5), scope_ids: FORK_SCOPE },
		]).rows

		expect(skill?.carried_requests).toBe(4)
		expect(skill?.cost_usd).toBeCloseTo(0.0002)
	})
})

describe('cost_documents.format_documents', () => {
	it('names the documents and closes with the total carry cost', () => {
		const breakdown = cost_documents.build([{ raw: RAW, records: records(5) }])

		const lines = cost_documents.format_documents(breakdown)

		expect(lines[0]).toContain('Entry-read documents')
		expect(lines.some((line) => line.includes('SKILL.md'))).toBe(true)
		expect(lines.at(-1)).toContain('total carry cost')
	})

	it('prints nothing for an empty breakdown', () => {
		expect(cost_documents.format_documents({ rows: [], total_cost_usd: 0 })).toEqual([])
	})
})
