import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { auto_ok_fixture, CREATED_EARLIER, EPIC_NUMBER } from '#scripts/auto-ok/auto-ok-fixture'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { josh_command } from '#scripts/josh/josh-run'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_startup } from '#scripts/run/startup/run-startup'
import type { StartupEntry } from '#scripts/run/startup/run-startup-schema'
import { run_startup_store } from '#scripts/run/startup/run-startup-store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'
import { backlog_next_shared } from './backlog-next-shared'

const rows: Array<StartupEntry> = []
const CHILD = 901
const CANDIDATE_ELIGIBILITY = 'candidate eligibility'

beforeEach(() => {
	rows.length = 0
	vi.spyOn(run_startup_store, 'record').mockImplementation(async (row) => {
		rows.push(row)
	})
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => vi.restoreAllMocks())

async function run_next(): Promise<number> {
	return await run_startup.within(
		{ run: 'run', attempt: 'next-attempt' },
		async () => await backlog_next.run([]),
	)
}

function endings(): Array<Array<string>> {
	return rows.filter((row) => row.edge !== 'start').map((row) => [row.phase, row.edge])
}

describe('backlog next startup states', () => {
	it('records a failed listing as failed', async () => {
		vi.spyOn(auto_ok_cli, 'fetch_opted_in').mockResolvedValue({ kind: 'unreadable' })

		expect(await run_next()).toBe(1)
		expect(endings()).toEqual([['candidate listing', 'failed']])
	})

	it.each([
		['done', []],
		['waiting', ['auto-ok', 'needs-decision']],
	])('records a %s eligibility result in both phases', async (edge, labels) => {
		backlog_fixture.stub_backlog({
			opted_in: [auto_ok_fixture.issue(CHILD, CREATED_EARLIER, labels)],
		})

		expect(await run_next()).toBe(0)
		expect(endings()).toContainEqual([CANDIDATE_ELIGIBILITY, edge])
		expect(endings()).toContainEqual(['eligibility', edge])
	})

	it('records an error verdict returned by resolution and the solo gate', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [auto_ok_fixture.opted_in_epic()],
			epics: [{ number: EPIC_NUMBER, children: [CHILD] }],
		})
		vi.spyOn(git_gh_command, 'issue_get_state_and_relations_classified').mockResolvedValue({
			kind: 'unreadable',
			reason: 'rejected',
			status: 403,
		})

		expect(await run_next()).toBe(0)
		expect(endings()).toContainEqual([CANDIDATE_ELIGIBILITY, 'failed'])
		expect(endings()).toContainEqual(['eligibility', 'failed'])
	})
})

describe('candidate cache fill telemetry', () => {
	it.each([
		['12', 0, 'done'],
		['wait', 0, 'waiting'],
		['retry', 0, 'failed'],
		['', 1, 'failed'],
	])('records %s exit %s as %s without changing the result', async (out, code, edge) => {
		shared_cache_fixture.keep_in_memory()
		vi.spyOn(run_event_stream_emit, 'stream_target').mockResolvedValue(undefined)
		vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ out, code })

		expect(
			await run_startup.within(
				{ run: 'run', attempt: 'cache-attempt' },
				async () => await backlog_next_shared.read(['backlog:next']),
			),
		).toEqual({ out, code })
		expect(endings()).toContainEqual(['candidate cache fill', edge])
	})
})
