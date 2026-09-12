import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AttributedRecord, Corpus } from './cost-corpus'
import { cost_document_sources } from './cost-document-sources'
import type { MissingData } from './cost-report'
import { cost_transcript, type SessionFile, type SessionUsage } from './cost-transcript'
import type { UsageRecord, UsageTotals } from './cost-usage'

const MODEL = 'claude-opus-4-8'
const SKILL_PATH = '/repo/.claude/skills/workflow-commands/SKILL.md'
const SKILL_SHORT = '.claude/skills/workflow-commands/SKILL.md'
const REQ_A = 'r1'
const REQ_B = 'r2'
const ISSUE = 1871

const EMPTY_TOTALS: UsageTotals = {
	input_tokens: 0,
	cache_write_5m_tokens: 0,
	cache_write_1h_tokens: 0,
	cache_read_tokens: 0,
	output_tokens: 0,
	thinking_tokens: 0,
}

const NO_MISSING: MissingData = {
	no_usage_lines: 0,
	malformed_lines: 0,
	unreadable_sessions: 0,
	unattributed_sessions: 0,
}

// A transcript that reads one document and then runs a second billed request, so the document is
// carried once — enough to prove the wiring reaches `cost_documents.build`.
function reading_transcript(): string {
	return [
		JSON.stringify({
			type: 'assistant',
			requestId: REQ_A,
			message: {
				model: MODEL,
				usage: { input_tokens: 1 },
				content: [{ type: 'tool_use', name: 'Read', id: 'tu_1', input: { file_path: SKILL_PATH } }],
			},
		}),
		JSON.stringify({
			type: 'user',
			message: {
				content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'x'.repeat(300) }],
			},
		}),
		JSON.stringify({
			type: 'assistant',
			requestId: REQ_B,
			message: { model: MODEL, usage: { input_tokens: 1 } },
		}),
	].join('\n')
}

function record(request_id: string): UsageRecord {
	return { request_id, model: MODEL, branch: 'main', at_ms: 0, totals: EMPTY_TOTALS }
}

function session(session_id: string): SessionUsage {
	return {
		session_id,
		records: [record(REQ_A), record(REQ_B)],
		no_usage_lines: 0,
		malformed_lines: 0,
		is_readable: true,
		baseline_tokens: 0,
	}
}

function file(session_id: string): SessionFile {
	return { session_id, path: `/tmp/${session_id}.jsonl`, modified_ms: 0, is_delegated: false }
}

function pair(request_id: string, session_id: string): AttributedRecord {
	return {
		record: record(request_id),
		issue: ISSUE,
		baseline_tokens: 0,
		session_id,
		is_delegated: false,
	}
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('cost_document_sources.for_session', () => {
	it('builds the document breakdown from the session transcript', () => {
		vi.spyOn(cost_transcript, 'read_raw').mockReturnValue(reading_transcript())

		const breakdown = cost_document_sources.for_session(file('s1'), session('s1'))

		expect(breakdown?.rows[0]?.path).toBe(SKILL_SHORT)
	})

	it('returns undefined for a session with no readable request', () => {
		const empty: SessionUsage = { ...session('s1'), records: [] }

		expect(cost_document_sources.for_session(file('s1'), empty)).toBeUndefined()
	})
})

describe('cost_document_sources.for_issue', () => {
	it('covers only the sessions that contributed a record to the issue', () => {
		const read_raw = vi.spyOn(cost_transcript, 'read_raw').mockReturnValue(reading_transcript())
		const corpus: Corpus = {
			files: [file('s1'), file('s2')],
			sessions: [session('s1'), session('s2')],
			missing: NO_MISSING,
		}

		const breakdown = cost_document_sources.for_issue(corpus, [
			pair(REQ_A, 's1'),
			pair(REQ_B, 's1'),
		])

		expect(breakdown.rows.map((row) => row.path)).toEqual([SKILL_SHORT])
		expect(read_raw).toHaveBeenCalledTimes(1)
	})
})
