import { beforeEach, describe, expect, it, vi } from 'vitest'
import { followup_job_rerun, RERUN_BACKOFF_MS } from './followup-job-rerun'
import { followup_job_rerun_fixture, UNIT_ID } from './followup-job-rerun-fixture'

// joshuafolkken/kit#6834: a download outage outlasts the first rerun, so a download failure is rerun on
// any attempt, each later rerun waits longer, and the jobs a spent cap leaves are read without a rerun.

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

vi.mock('#scripts/observations/observation-record', () => ({
	observation_record: { assess: vi.fn() },
	REFUSED_VERDICT: 'refused',
}))

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_comment: vi.fn() },
}))

vi.mock(import('./followup-job-needs'), async (import_original) => {
	const actual = await import_original()

	return { followup_job_needs: { ...actual.followup_job_needs, read_graph: vi.fn() } }
})

vi.mock('./followup-main-move', () => ({
	followup_main_move: { should_merge_first: vi.fn() },
}))

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const { git_gh_exec } = await import('#scripts/gh/git-gh-exec')
const { changed_paths } = await import('#scripts/git/changed-paths')
const { observation_record } = await import('#scripts/observations/observation-record')
const { followup_job_needs } = await import('./followup-job-needs')
const { followup_main_move } = await import('./followup-main-move')

const read_changed = vi.mocked(changed_paths.read_changed_paths)
const assess = vi.mocked(observation_record.assess)
const { answer_actions, answer_checks, as_check, job, rerun_paths } = followup_job_rerun_fixture
const { read_rerun_names, rerun_failed_jobs } = followup_job_rerun

const BRANCH_NAME = '6834-lane'
const UNIT_NAME = 'Unit Tests'
const FAILURE = 'failure'
const FAILED_STEPS = ['success', FAILURE]
const OUTSIDE_TEST = 'scripts/run/board/run-board-frame-budget.test.ts'
const UNIT_LOG = `2026-10-27T10:00:00.0000000Z  FAIL  ${OUTSIDE_TEST} > frame budget > reads the budget\n`
const CURL_504 = [
	'2026-11-08T08:58:56.5220933Z curl: (22) The requested URL returned error: 504',
	'2026-11-08T08:59:02.6053812Z ##[error]Process completed with exit code 22.',
	'',
].join('\n')
const SECOND_ATTEMPT = 2
const THIRD_ROUND = 2

function failed_unit(run_attempt: number): object {
	return job({
		id: UNIT_ID,
		name: UNIT_NAME,
		conclusion: FAILURE,
		steps: FAILED_STEPS,
		run_attempt,
	})
}

function answer_unit(run_attempt: number, log: string): void {
	answer_checks([as_check(failed_unit(run_attempt))])
	answer_actions({ jobs: [failed_unit(run_attempt)], log })
}

async function rerun_with_timers(
	round: number,
): Promise<{ names: Array<string>; waited_ms: number }> {
	vi.useFakeTimers()
	const started = Date.now()
	const pending = rerun_failed_jobs(BRANCH_NAME, round)

	await vi.runAllTimersAsync()
	const names = await pending
	const waited_ms = Date.now() - started

	vi.useRealTimers()

	return { names, waited_ms }
}

beforeEach(() => {
	vi.mocked(git_gh_command.pr_get_checks_snapshot).mockReset()
	vi.mocked(git_gh_exec.exec_gh_api).mockReset()
	assess.mockReset()
	read_changed.mockReset().mockResolvedValue([])
	vi.mocked(followup_job_needs.read_graph).mockReset().mockResolvedValue([])
	vi.mocked(followup_main_move.should_merge_first).mockReset().mockResolvedValue(false)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

describe('rerun_failed_jobs — a download failure on a later attempt', () => {
	it('reruns a job whose second attempt failed on a setup curl answered 504', async () => {
		answer_unit(SECOND_ATTEMPT, CURL_504)

		expect(await rerun_failed_jobs(BRANCH_NAME)).toStrictEqual([UNIT_NAME])
		expect(rerun_paths()).toHaveLength(1)
	})

	it.each([1, SECOND_ATTEMPT])(
		'does not rerun attempt %i red on a test of the change',
		async (run_attempt) => {
			read_changed.mockResolvedValue([OUTSIDE_TEST])
			answer_unit(run_attempt, UNIT_LOG)

			expect(await rerun_failed_jobs(BRANCH_NAME)).toStrictEqual([])
			expect(rerun_paths()).toStrictEqual([])
			expect(assess).not.toHaveBeenCalled()
		},
	)

	// The rerun endpoint retries every failed job of the run, so one red on its own keeps the outage's.
	it('does not rerun a run where a download failure sits beside a job red on something else', async () => {
		const lint = job({ id: UNIT_ID + 1, name: 'Lint', conclusion: FAILURE, steps: FAILED_STEPS })

		answer_checks([as_check(failed_unit(SECOND_ATTEMPT)), as_check(lint)])
		answer_actions({ jobs: [failed_unit(SECOND_ATTEMPT), lint], log: CURL_504 })

		expect(await rerun_failed_jobs(BRANCH_NAME)).toStrictEqual([])
		expect(rerun_paths()).toStrictEqual([])
	})
})

describe('rerun_failed_jobs — the wait before a later rerun', () => {
	it.each([
		[0, 0],
		[1, RERUN_BACKOFF_MS],
		[THIRD_ROUND, RERUN_BACKOFF_MS + RERUN_BACKOFF_MS],
	])('waits before rerun round %i for %i ms', async (round, expected_ms) => {
		answer_unit(SECOND_ATTEMPT, CURL_504)

		const { names, waited_ms } = await rerun_with_timers(round)

		expect(names).toStrictEqual([UNIT_NAME])
		expect(waited_ms).toBe(expected_ms)
	})

	it('does not wait when there is nothing to rerun', async () => {
		read_changed.mockResolvedValue([OUTSIDE_TEST])
		answer_unit(1, UNIT_LOG)

		const { waited_ms } = await rerun_with_timers(THIRD_ROUND)

		expect(waited_ms).toBe(0)
	})
})

describe('read_rerun_names', () => {
	it('names the jobs a rerun would retry without rerunning them', async () => {
		answer_unit(SECOND_ATTEMPT, CURL_504)

		expect(await read_rerun_names(BRANCH_NAME)).toStrictEqual([UNIT_NAME])
		expect(rerun_paths()).toStrictEqual([])
	})

	it('names none when a job is red on the change', async () => {
		read_changed.mockResolvedValue([OUTSIDE_TEST])
		answer_unit(1, UNIT_LOG)

		expect(await read_rerun_names(BRANCH_NAME)).toStrictEqual([])
	})
})

describe('reruns_spent_message', () => {
	it('names the outage and the jobs still failing', () => {
		const message = followup_job_rerun.reruns_spent_message([UNIT_NAME])

		expect(message).toContain('CI infrastructure failures outlasted every followup rerun')
		expect(message).toContain(UNIT_NAME)
	})
})
