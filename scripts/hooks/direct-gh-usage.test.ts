import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { gh_usage_log } from '#scripts/gh/gh-usage-log'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_carry } from '#scripts/run/carry/run-carry'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { direct_gh_usage } from './direct-gh-usage'
import { hook_ledger } from './hook-ledger'

// joshuafolkken/kit#6781: the hook counts the `gh` a session types, one gh usage line per call.

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

const { pretool_guard } = await import('./pretool-guard')

const WORK_DIRECTORY = temporary_directory('suite')('direct-gh-usage-')
const TRANSCRIPT = path.join(WORK_DIRECTORY, 'session.jsonl')
const LANE_ISSUE = 6781
const PR_CHECKS = 'gh pr checks 1'
const PR_VIEW = 'direct:pr view'

writeFileSync(TRANSCRIPT, '')

beforeEach(() => {
	vi.stubEnv('VITEST', undefined)
	vi.spyOn(lane_child_marker, 'marked_issue').mockReturnValue(undefined)
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(WORK_DIRECTORY)
	vi.spyOn(hook_ledger, 'record_reason').mockResolvedValue(undefined)
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

function bash_payload(command: string): string {
	return JSON.stringify({ tool_name: 'Bash', tool_input: { command }, transcript_path: TRANSCRIPT })
}

async function written_lines(command: string): Promise<Array<unknown>> {
	const append = vi.spyOn(gh_usage_log, 'append').mockReturnValue(undefined)

	await direct_gh_usage.record(bash_payload(command))

	return append.mock.calls.map(([, record]) => record)
}

async function written_commands(command: string): Promise<Array<unknown>> {
	const lines = await written_lines(command)

	return lines.map((line) => (line as { command: string }).command)
}

describe('direct_gh_usage.record', () => {
	it('writes one `direct:pr checks` line for `gh pr checks 1`', async () => {
		expect(await written_lines(PR_CHECKS)).toEqual([
			{
				at: expect.any(String),
				command: 'direct:pr checks',
				issue: undefined,
				calls: 1,
				not_modified: 0,
				elapsed_ms: 0,
			},
		])
	})

	it.each(['gh api rate_limit', 'gh api /rate_limit', 'gh api --method GET rate_limit'])(
		'writes nothing for the free `%s`',
		async (command) => {
			expect(await written_commands(command)).toEqual([])
		},
	)
})

describe('direct_gh_usage.record — the calls a command line launches', () => {
	it('writes one line for a `gh` inside a command substitution or a `bash -c` script', async () => {
		expect(await written_commands('N=$(gh pr view 1) && bash -c "gh pr view 2"')).toEqual([
			PR_VIEW,
			PR_VIEW,
		])
	})

	it('writes one line per `gh` on an `&&` line', async () => {
		expect(await written_commands('gh pr view 1 && gh api repos/o/r/pulls')).toEqual([
			PR_VIEW,
			'direct:api',
		])
	})

	it('writes one line for a `gh` piped into `jq`', async () => {
		expect(await written_commands("gh pr view 1 --json x | jq '.x'")).toEqual([PR_VIEW])
	})

	it('writes nothing for a command that is not `gh`', async () => {
		expect(await written_commands('ls -la')).toEqual([])
	})

	it('writes the lane child issue when the marker is set', async () => {
		vi.spyOn(lane_child_marker, 'marked_issue').mockReturnValue(String(LANE_ISSUE))

		expect(await written_lines('gh run view 9')).toEqual([
			expect.objectContaining({ command: 'direct:run view', issue: LANE_ISSUE }),
		])
	})
})

async function hook_run(command: string): Promise<{ output: Array<unknown>; exit: unknown }> {
	const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

	await pretool_guard.respond(bash_payload(command))

	return { output: write.mock.calls.map(([text]) => text), exit: process.exitCode }
}

describe('pretool_guard.respond — direct gh usage', () => {
	it('keeps the verdict and the exit code when the log write throws', async () => {
		const append = vi.spyOn(gh_usage_log, 'append').mockReturnValue(undefined)
		const quiet = await hook_run(PR_CHECKS)

		append.mockClear().mockImplementation(() => {
			throw new Error('locked')
		})

		expect(await hook_run(PR_CHECKS)).toEqual(quiet)
		expect(append).toHaveBeenCalledOnce()
	})

	it('counts no `gh` the hook refused', async () => {
		const append = vi.spyOn(gh_usage_log, 'append').mockReturnValue(undefined)

		await hook_run('gh issue view 7')

		expect(append).not.toHaveBeenCalled()
	})
})
