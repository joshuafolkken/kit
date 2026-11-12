import { POLL_BACKOFF } from '#scripts/lib/poll'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	COMPLETE_ATTEMPTS,
	COMPLETE_INTERVAL_MS,
	followup_job_rerun,
	REGISTER_ATTEMPTS,
	REGISTER_INTERVAL_MS,
} from './followup-job-rerun'
import { followup_job_rerun_fixture } from './followup-job-rerun-fixture'

// joshuafolkken/kit#6725: each wait around a rerun backs off while its reading stays the same, over
// the total wait the fixed cadence had.

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { pr_get_checks_snapshot: vi.fn() },
}))

vi.mock(import('#scripts/gh/git-gh-exec'), async (import_original) => {
	const actual = await import_original()

	return { ...actual, git_gh_exec: { ...actual.git_gh_exec, exec_gh_api: vi.fn() } }
})

vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: { read_changed_paths: vi.fn() },
}))

vi.mock('./followup-main-move', () => ({
	followup_main_move: { should_merge_first: vi.fn() },
}))

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const { git_gh_exec } = await import('#scripts/gh/git-gh-exec')
const { changed_paths } = await import('#scripts/git/changed-paths')
const { followup_main_move } = await import('./followup-main-move')

const fetch_checks = vi.mocked(git_gh_command.pr_get_checks_snapshot)
const { answer_actions, answer_checks, as_check, job, rerun_paths } = followup_job_rerun_fixture

const BRANCH_NAME = '6725-lane'
const DETECT_E2E_NAME = 'Detect E2E'
const DETECT_E2E = job({ id: 101, name: DETECT_E2E_NAME, conclusion: 'cancelled' })
const PLAYWRIGHT = job({ id: 102, name: 'Resolve Playwright image', conclusion: 'timed_out' })

async function rerun_with_timers(): Promise<{ names: Array<string>; waited_ms: number }> {
	vi.useFakeTimers()
	const started = Date.now()
	const pending = followup_job_rerun.rerun_failed_jobs(BRANCH_NAME)

	await vi.runAllTimersAsync()
	const names = await pending
	const waited_ms = Date.now() - started

	vi.useRealTimers()

	return { names, waited_ms }
}

beforeEach(() => {
	fetch_checks.mockReset()
	vi.mocked(git_gh_exec.exec_gh_api).mockReset()
	vi.mocked(changed_paths.read_changed_paths).mockReset().mockResolvedValue([])
	vi.mocked(followup_main_move.should_merge_first).mockReset().mockResolvedValue(false)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

describe('rerun_failed_jobs — the wait for the run to complete', () => {
	// GitHub refuses a rerun while the run is still going, and the gate fails on the first red check.
	// The backoff watches the run status: a new one starts the next wait from the first interval.
	it('waits for the run to complete before rerunning it', async () => {
		answer_checks([as_check(DETECT_E2E)])
		answer_actions({ jobs: [DETECT_E2E], statuses: ['queued', 'in_progress'] })

		const { names, waited_ms } = await rerun_with_timers()

		expect(names).toStrictEqual([DETECT_E2E_NAME])
		expect(waited_ms).toBe(POLL_BACKOFF.initial_ms + POLL_BACKOFF.initial_ms)
		expect(rerun_paths()).toHaveLength(1)
	})

	it('does not rerun a run that never completes, backing off over the whole wait', async () => {
		const statuses = Array.from({ length: COMPLETE_ATTEMPTS }, () => 'queued')

		answer_checks([as_check(DETECT_E2E)])
		answer_actions({ jobs: [DETECT_E2E], statuses })

		const { names, waited_ms } = await rerun_with_timers()

		expect(names).toStrictEqual([])
		expect(waited_ms).toBe((COMPLETE_ATTEMPTS - 1) * COMPLETE_INTERVAL_MS)
		expect(statuses.length).toBeGreaterThan(0)
		expect(rerun_paths()).toStrictEqual([])
	})
})

describe('rerun_failed_jobs — the wait for the rerun to register', () => {
	it('waits until the rerun replaced the stalled check runs, backing off over the whole wait', async () => {
		answer_checks([as_check(DETECT_E2E)], [as_check(DETECT_E2E)])
		answer_actions({ jobs: [DETECT_E2E] })

		const { waited_ms } = await rerun_with_timers()

		expect(waited_ms).toBe((REGISTER_ATTEMPTS - 1) * REGISTER_INTERVAL_MS)
		expect(fetch_checks.mock.calls.length).toBeLessThan(1 + REGISTER_ATTEMPTS)
	})

	// The backoff watches the failed check ids: one the rerun replaced starts the next wait over.
	it('waits from the first interval again once the rerun replaced one check', async () => {
		const stalled = [as_check(DETECT_E2E), as_check(PLAYWRIGHT)]

		// Each call queues its first read: the find, then the wait's reads, then none left failed.
		answer_checks(stalled)
		answer_checks(stalled)
		answer_checks([as_check(DETECT_E2E)])
		answer_actions({ jobs: [DETECT_E2E, PLAYWRIGHT] })

		const { waited_ms } = await rerun_with_timers()

		expect(waited_ms).toBe(REGISTER_INTERVAL_MS + REGISTER_INTERVAL_MS)
	})
})
