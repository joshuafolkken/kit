import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { hook_context_fixture } from '#tools/hooks/hook-context-fixture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { direct_gh_usage } from './direct-gh-usage'
import { hook_demoted } from './hook-demoted'
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
const ALLOWED_COMMAND = 'git rev-parse HEAD'

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
		expect(await recorded_reasons(ALLOWED_COMMAND)).toEqual([[HOOK, undefined]])
	})
})

describe('pretool_guard.record_refusal — the call context', () => {
	it('reads the demoted rules from the call context and hands both recorders that context', async () => {
		const environment = { VITEST: 'true', MARK: 'x' }
		const context = hook_context_fixture.of(WORK_DIRECTORY, environment)
		const payload = bash_payload(ALLOWED_COMMAND)
		const rules = vi.spyOn(hook_demoted, 'rules')
		const ledger = vi.spyOn(hook_ledger, 'record_reason').mockResolvedValue(undefined)
		const usage = vi.spyOn(direct_gh_usage, 'record').mockResolvedValue(undefined)

		await pretool_guard.record_refusal(
			payload,
			{ reason: undefined, notice: undefined, fault: undefined },
			context,
		)

		expect(rules).toHaveBeenCalledWith(environment)
		expect(ledger).toHaveBeenCalledWith(HOOK, undefined, payload, context)
		expect(usage).toHaveBeenCalledWith(payload, context)
	})
})
