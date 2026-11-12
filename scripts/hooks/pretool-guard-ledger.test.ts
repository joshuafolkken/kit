import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { direct_issue_comment } from '#scripts/rules/direct-issue-comment'
import { direct_issue_read } from '#scripts/rules/direct-issue-read'
import { hook_context_fixture } from '#tools/hooks/hook-context-fixture'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { direct_gh_usage } from './direct-gh-usage'
import { hook_demoted } from './hook-demoted'
import { hook_ledger } from './hook-ledger'

// joshuafolkken/kit#6587: the one hook process hands the ledger what it denied, and #7330's rewrites
// at the hook. A separate suite from `pretool-guard.test.ts`, which is at its length limit.

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
		expect(await recorded_reasons('gh issue view 7 --comments')).toEqual([
			[HOOK, expect.stringContaining('⛔ direct issue read')],
		])
	})

	it('hands the ledger no reason for a call it let through', async () => {
		expect(await recorded_reasons(ALLOWED_COMMAND)).toEqual([[HOOK, undefined]])
	})
})

async function envelope_of(command: string): Promise<string> {
	vi.spyOn(hook_ledger, 'record_reason').mockResolvedValue(undefined)
	const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

	await pretool_guard.respond(bash_payload(command))

	return write.mock.calls.map((call) => String(call[0])).join('')
}

// joshuafolkken/kit#7330: a standalone issue read or body-file post is rewritten, not denied.
describe('pretool_guard.respond — the standalone issue-command rewrites', () => {
	it.each([
		['gh issue view 7', 'pnpm josh issue:read 7', direct_issue_read.ISSUE_READ_NOTE],
		[
			'gh issue comment 7 -F /work/.josh/tmp/b.md',
			'pnpm josh issue:comment 7 --body-file /work/.josh/tmp/b.md',
			direct_issue_comment.ISSUE_COMMENT_NOTE,
		],
	])(
		'runs %j as %j, deciding nothing, with the note attached',
		async (command, rewritten, note) => {
			const envelope = await envelope_of(command)

			expect(envelope).not.toContain('"permissionDecision"')
			expect(envelope).toContain(`"updatedInput":${JSON.stringify({ command: rewritten })}`)
			expect(envelope).toContain(JSON.stringify(note).slice(1, -1))
		},
	)
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
