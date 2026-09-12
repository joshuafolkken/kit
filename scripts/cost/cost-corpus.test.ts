import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cost_corpus } from './cost-corpus'
import { cost_transcript } from './cost-transcript'

// joshuafolkken/kit#1812: a delegated unit runs before the commit, so its transcript carries `main`
// on every line and the branch fill has no issue to reach — its cost was charged to no issue while
// the `missing` counters read zero. A unit now follows its own branch first and the session that
// delegated it second, and one that still cannot be placed is counted.

const CWD = '/Users/someone/Development/kit'
const ISSUE_BRANCH = '962-report-the-token-and-credit-cost-of-a-run'
const NEXT_BRANCH = '963-single-source-the-three-ai-documents'
const MAIN = 'main'
const SESSION_A = 'session-a'
const MODEL = 'claude-opus-5'
const ISSUE_962 = 962

function usage_line(request_id: string, branch: string): string {
	return JSON.stringify({
		type: 'assistant',
		requestId: request_id,
		gitBranch: branch,
		message: { model: MODEL, usage: { input_tokens: 1, output_tokens: 10 } },
	})
}

const state = { home: '' }

beforeEach(() => {
	state.home = mkdtempSync(path.join(tmpdir(), 'cost-corpus-'))
	vi.spyOn(cost_transcript, 'transcript_directories').mockImplementation((cwd: string) => [
		path.join(state.home, cost_transcript.project_slug(cwd)),
	])
})

afterEach(() => {
	vi.restoreAllMocks()
})

function write_session(session_id: string, lines: ReadonlyArray<string>): void {
	const directory = path.join(state.home, cost_transcript.project_slug(CWD))

	mkdirSync(directory, { recursive: true })
	writeFileSync(path.join(directory, `${session_id}.jsonl`), lines.join('\n'))
}

// A delegated unit's transcript, written where the discovery expects one:
// `<parent>/subagents/agent-<id>.jsonl`.
function write_unit(parent_id: string, agent_id: string, lines: ReadonlyArray<string>): void {
	const directory = path.join(state.home, cost_transcript.project_slug(CWD), parent_id, 'subagents')

	mkdirSync(directory, { recursive: true })
	writeFileSync(path.join(directory, `${agent_id}.jsonl`), lines.join('\n'))
}

function issues_for(target: number): number {
	return cost_corpus
		.attributed(cost_corpus.load_corpus(CWD))
		.filter((pair) => pair.issue === target).length
}

describe('cost_corpus.attribute_corpus — delegated units', () => {
	// The unit ran on the default branch, before its parent's commit created the issue branch, so it
	// follows the parent's sole issue rather than falling out of the total.
	it("attributes a unit that ran on the default branch to its parent's issue", () => {
		write_session(SESSION_A, [usage_line('r1', MAIN), usage_line('r2', ISSUE_BRANCH)])
		write_unit(SESSION_A, 'agent-1', [usage_line('u1', MAIN)])

		expect(issues_for(ISSUE_962)).toBe(3)
	})

	// A child that committed carries its own `<N>-` branch, so its unit attributes by its own records
	// rather than being overridden by the session that delegated it.
	it('keeps a unit attributed by its own issue branch', () => {
		write_session(SESSION_A, [usage_line('r1', ISSUE_BRANCH)])
		write_unit(SESSION_A, 'agent-1', [usage_line('u1', NEXT_BRANCH)])

		expect(issues_for(963)).toBe(1)
	})

	// A parent that ran two issues names no single one, so its pre-commit unit is not charged to a
	// guess: it is counted as a floor for the issues that parent touched, and for no others.
	it('counts a unit as a floor only for the issues its parent touched', () => {
		write_session(SESSION_A, [usage_line('r1', ISSUE_BRANCH), usage_line('r2', NEXT_BRANCH)])
		write_unit(SESSION_A, 'agent-1', [usage_line('u1', MAIN)])

		const { unattributed } = cost_corpus.attribute_corpus(cost_corpus.load_corpus(CWD))

		expect(cost_corpus.floor_for_issue(unattributed, ISSUE_962)).toBe(1)
		expect(cost_corpus.floor_for_issue(unattributed, 999)).toBe(0)
	})
})
