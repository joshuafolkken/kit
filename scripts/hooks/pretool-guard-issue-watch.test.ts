import { closeSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#3773: the issue watch is the third asynchronous rule, after the watcher and the
// parent hand-off, so a person's issue update reaches the session on its next tool call. A separate
// suite from `pretool-guard.test.ts`, which is at its length limit.

vi.mock('#scripts/hooks/lane-plan-guard', () => ({
	lane_plan_guard: { reason: vi.fn().mockReturnValue(undefined) },
}))

vi.mock('#scripts/run/run-watcher-hook', () => ({
	run_watcher_hook: { watcher_hook_reason: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/run/run-parent-cut-hook', () => ({
	run_parent_cut_hook: { parent_cut_reason: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/issue/issue-watch-hook', () => ({
	issue_watch_hook: { watch_reason: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/lane/lane-phase', () => ({
	lane_phase: { mark_implement: vi.fn().mockResolvedValue(undefined) },
}))

const { run_parent_cut_hook } = await import('#scripts/run/run-parent-cut-hook')
const { issue_watch_hook } = await import('#scripts/issue/issue-watch-hook')
const { pretool_outcome_async } = await import('./pretool-guard')

const parent_cut_reason = vi.mocked(run_parent_cut_hook.parent_cut_reason)
const watch_reason = vi.mocked(issue_watch_hook.watch_reason)

const BENIGN_COMMAND = 'ls'
const UPDATE_REASON = 'A person updated issue #3773'
const PARENT_CUT_REASON = 'parent hand-off'

function payload(command: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'pretool-guard-watch-'))
	const transcript_path = path.join(directory, 'transcript.jsonl')

	writeFileSync(transcript_path, '{"type":"user"}\n')
	closeSync(openSync(transcript_path, 'r'))

	return JSON.stringify({ tool_name: 'Bash', tool_input: { command }, transcript_path })
}

afterEach(() => {
	parent_cut_reason.mockReset().mockResolvedValue(undefined)
	watch_reason.mockReset().mockResolvedValue(undefined)
})

describe('pretool_outcome_async — the composed issue watch', () => {
	it('surfaces an issue update on a call everything else cleared', async () => {
		watch_reason.mockResolvedValue(UPDATE_REASON)

		const refusal = await pretool_outcome_async(payload(BENIGN_COMMAND))

		expect(refusal.reason).toBe(UPDATE_REASON)
	})

	it('shows the parent hand-off first, without polling the issue', async () => {
		parent_cut_reason.mockResolvedValue(PARENT_CUT_REASON)
		watch_reason.mockResolvedValue(UPDATE_REASON)

		const refusal = await pretool_outcome_async(payload(BENIGN_COMMAND))

		expect(refusal.reason).toBe(PARENT_CUT_REASON)
		expect(watch_reason).not.toHaveBeenCalled()
	})
})
