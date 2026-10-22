import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The poll guard is the third asynchronous rule, after the watcher and the parent hand-off and before
// the issue watch. A separate suite from `pretool-guard.test.ts`, which is at its length limit.

vi.mock('#scripts/run/run-watcher-hook', () => ({
	run_watcher_hook: { watcher_hook_reason: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/run/run-parent-cut-hook', () => ({
	run_parent_cut_hook: { parent_cut_reason: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/run/run-poll-hook', () => ({
	run_poll_hook: { safe_poll_reason: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/issue/issue-watch-hook', () => ({
	issue_watch_hook: { watch_reason: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/lane/lane-phase', () => ({
	lane_phase: { mark_implement: vi.fn().mockResolvedValue(undefined) },
}))

const { run_parent_cut_hook } = await import('#scripts/run/run-parent-cut-hook')
const { run_poll_hook } = await import('#scripts/run/run-poll-hook')
const { issue_watch_hook } = await import('#scripts/issue/issue-watch-hook')
const { pretool_outcome_async } = await import('./pretool-guard')

const parent_cut_reason = vi.mocked(run_parent_cut_hook.parent_cut_reason)
const safe_poll_reason = vi.mocked(run_poll_hook.safe_poll_reason)
const watch_reason = vi.mocked(issue_watch_hook.watch_reason)

const BOARD = 'pnpm josh run:board'
const POLL_REASON = 'poll'
const PARENT_CUT_REASON = 'parent hand-off'

function payload(command: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'pretool-guard-poll-'))
	const transcript_path = path.join(directory, 'transcript.jsonl')

	writeFileSync(transcript_path, '{"type":"user"}\n')

	return JSON.stringify({ tool_name: 'Bash', tool_input: { command }, transcript_path })
}

afterEach(() => {
	parent_cut_reason.mockReset().mockResolvedValue(undefined)
	safe_poll_reason.mockReset().mockResolvedValue(undefined)
	watch_reason.mockReset().mockResolvedValue(undefined)
})

describe('pretool_outcome_async — the composed poll guard', () => {
	it('surfaces the poll refusal on a call everything earlier cleared', async () => {
		safe_poll_reason.mockResolvedValue(POLL_REASON)

		const outcome = await pretool_outcome_async(payload(BOARD))

		expect(outcome.reason).toBe(POLL_REASON)
		expect(watch_reason).not.toHaveBeenCalled()
	})

	it('shows the parent hand-off first, without asking the poll guard', async () => {
		parent_cut_reason.mockResolvedValue(PARENT_CUT_REASON)
		safe_poll_reason.mockResolvedValue(POLL_REASON)

		const outcome = await pretool_outcome_async(payload(BOARD))

		expect(outcome.reason).toBe(PARENT_CUT_REASON)
		expect(safe_poll_reason).not.toHaveBeenCalled()
	})
})
