import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hook_ledger } from './hook-ledger'

// joshuafolkken/kit#6587: the one hook process hands the ledger what it denied. A separate suite from
// `pretool-guard.test.ts`, which is at its length limit.

vi.mock('#scripts/hooks/lane-plan-guard', () => ({
	lane_plan_guard: { reason: vi.fn().mockReturnValue(undefined) },
}))

vi.mock('#scripts/run/run-watcher-hook', () => ({
	run_watcher_hook: { watcher_hook_reason: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/run/run-parent-cut-hook', () => ({
	run_parent_cut_hook: {
		current_state: vi.fn(),
		parent_cut_reason: vi.fn().mockResolvedValue(undefined),
	},
}))

vi.mock('#scripts/issue/issue-watch-hook', () => ({
	issue_watch_hook: { watch_reason: vi.fn().mockResolvedValue(undefined) },
}))

const { pretool_guard } = await import('./pretool-guard')

const WORK_DIRECTORY = temporary_directory('suite')('pretool-guard-ledger-')
const TRANSCRIPT = path.join(WORK_DIRECTORY, 'session.jsonl')
const HOOK = 'pretool-guard'

writeFileSync(TRANSCRIPT, '')

afterEach(() => {
	vi.restoreAllMocks()
})

function bash_payload(command: string): string {
	return JSON.stringify({ tool_name: 'Bash', tool_input: { command }, transcript_path: TRANSCRIPT })
}

async function recorded_reasons(command: string): Promise<Array<unknown>> {
	const record = vi.spyOn(hook_ledger, 'record_reason').mockResolvedValue(undefined)

	vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	await pretool_guard.respond(bash_payload(command))

	return record.mock.calls.map((call) => call.slice(0, 2))
}

describe('pretool_guard.respond — the hook ledger', () => {
	it('hands the ledger the reason it denied the call with', async () => {
		expect(await recorded_reasons('gh issue view 7')).toEqual([
			[HOOK, expect.stringContaining('⛔ direct issue read')],
		])
	})

	it('hands the ledger no reason for a call it let through', async () => {
		expect(await recorded_reasons('git status')).toEqual([[HOOK, undefined]])
	})
})
