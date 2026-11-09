import { beforeEach, describe, expect, it, vi } from 'vitest'
import { followup_job_rerun } from './followup-job-rerun'
import {
	ACTIONS,
	followup_job_rerun_fixture,
	RUN_ID,
	SUCCESS,
	UNIT_ID,
} from './followup-job-rerun-fixture'

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
const { git_gh_issue_write } = await import('#scripts/gh/git-gh-issue-write')
const { followup_main_move } = await import('./followup-main-move')

const fetch_checks = vi.mocked(git_gh_command.pr_get_checks_snapshot)
const api = vi.mocked(git_gh_exec.exec_gh_api)
const read_changed = vi.mocked(changed_paths.read_changed_paths)
const assess = vi.mocked(observation_record.assess)
const comment = vi.mocked(git_gh_issue_write.issue_comment)
const merge_first = vi.mocked(followup_main_move.should_merge_first)
const { answer_actions, answer_checks, as_check, job, rerun_paths } = followup_job_rerun_fixture

const BRANCH_NAME = '4813-lane'
const ISSUE_NUMBER = 4813
const SIGHTING = '- k:followup-unrelated-test-rerun | d1 | 2026-10-28 | a.test.ts | followup reran'
const OTHER_RUN_ID = 40_117_183_014
const CANCELLED = 'cancelled'
const DETECT_E2E_NAME = 'Detect E2E'
const PLAYWRIGHT_NAME = 'Resolve Playwright image'
const UNIT_NAME = 'Unit Tests'
const DETECT_E2E_ID = 101

const FAILURE = 'failure'
const FAILED_STEPS = [SUCCESS, FAILURE]
const OUTSIDE_TEST = 'scripts/run/board/run-board-frame-budget.test.ts'
const FAILED_TEST = `${OUTSIDE_TEST} > frame budget > reads the budget`
const UNIT_LOG = `2026-10-27T10:00:00.0000000Z  FAIL  ${FAILED_TEST}\n`
const CURL_ERROR = '2026-11-08T08:58:56.5220933Z curl: (22) The requested URL returned error:'
const CURL_EXIT = '2026-11-08T08:59:02.6053812Z ##[error]Process completed with exit code 22.'

function curl_failed(status: number): string {
	return `${CURL_ERROR} ${String(status)}\n${CURL_EXIT}\n`
}

function installer_failed(status: number): string {
	return [
		`${CURL_ERROR} ${String(status)}`,
		'2026-11-08T11:54:13.0207669Z \u{1B}[0;31m[ERROR]\u{1B}[0m Failed to download from https://github.com/AikidoSec/safe-chain/releases/download/1.5.27/safe-chain-linuxstatic-x64',
		'2026-11-08T11:54:13.0242832Z ##[error]Process completed with exit code 1.',
	].join('\n')
}

const DETECT_E2E = job({ id: DETECT_E2E_ID, name: DETECT_E2E_NAME, conclusion: CANCELLED })
const PLAYWRIGHT = job({ id: 102, name: PLAYWRIGHT_NAME, conclusion: 'timed_out' })
const UNIT_PASSED = job({ id: UNIT_ID, name: UNIT_NAME, conclusion: SUCCESS })

function failed_unit(run_attempt = 1): object {
	return job({
		id: UNIT_ID,
		name: UNIT_NAME,
		conclusion: FAILURE,
		steps: FAILED_STEPS,
		run_attempt,
	})
}

async function expect_no_rerun(): Promise<void> {
	expect(await followup_job_rerun.rerun_failed_jobs(BRANCH_NAME)).toStrictEqual([])
	expect(rerun_paths()).toStrictEqual([])
}

beforeEach(() => {
	fetch_checks.mockReset()
	api.mockReset()
	assess.mockReset().mockResolvedValue({ verdict: 'ledger', earlier: [], line: SIGHTING })
	comment.mockReset().mockResolvedValue('https://comment')
	read_changed.mockReset().mockResolvedValue(['scripts/followup/followup-job-rerun.ts'])
	merge_first.mockReset().mockResolvedValue(false)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

describe('rerun_failed_jobs — a run whose only failures stopped after every step passed', () => {
	it('reruns the run once for its cancelled and timed-out jobs and names them', async () => {
		answer_checks([as_check(DETECT_E2E), as_check(PLAYWRIGHT)])
		answer_actions({ jobs: [DETECT_E2E, PLAYWRIGHT, UNIT_PASSED] })

		const names = await followup_job_rerun.rerun_failed_jobs(BRANCH_NAME)

		expect(names).toStrictEqual([DETECT_E2E_NAME, PLAYWRIGHT_NAME])
		expect(rerun_paths()).toStrictEqual([`${ACTIONS}runs/${String(RUN_ID)}/rerun-failed-jobs`])
		expect(console.info).toHaveBeenCalledWith(
			`🔁 Rerunning CI jobs that stopped after every step passed, failed on a download, or failed only outside the change: ${DETECT_E2E_NAME}, ${PLAYWRIGHT_NAME}`,
		)
		expect(assess).not.toHaveBeenCalled()
	})
})

describe('rerun_failed_jobs — a failure of the change itself is never rerun', () => {
	it.each([
		['a failed step', [SUCCESS, 'failure']],
		['a cancelled step', [SUCCESS, CANCELLED]],
		['a step that never finished', [SUCCESS, undefined]],
		['no steps', []],
	])('does not rerun a stalled job with %s', async (_label, steps) => {
		const stalled = job({ id: DETECT_E2E_ID, name: DETECT_E2E_NAME, conclusion: CANCELLED, steps })

		answer_checks([as_check(stalled)])
		answer_actions({ jobs: [stalled] })

		await expect_no_rerun()
	})

	// The endpoint reruns every failed job of the run, so a test the change broke beside the stalled job
	// would be retried into a merge.
	it('does not rerun a run that also holds a job that failed on the change', async () => {
		const steps = FAILED_STEPS
		const unit_failed = job({ id: UNIT_ID, name: UNIT_NAME, conclusion: FAILURE, steps })

		read_changed.mockResolvedValue([OUTSIDE_TEST])
		answer_checks([as_check(DETECT_E2E), as_check(unit_failed)])
		answer_actions({ jobs: [DETECT_E2E, unit_failed], log: UNIT_LOG })

		await expect_no_rerun()
	})

	it('reruns no run when one of them does not qualify', async () => {
		const other = job({
			id: UNIT_ID,
			name: UNIT_NAME,
			conclusion: CANCELLED,
			steps: ['failure'],
			run_id: OTHER_RUN_ID,
		})

		answer_checks([as_check(DETECT_E2E), as_check(other)])
		answer_actions({ jobs: [DETECT_E2E, other] })

		await expect_no_rerun()
	})
})

// joshuafolkken/kit#5171: a test the diff never touched went red under runner load and stopped
// `followup` until a relaunched session typed the rerun by hand.
describe('rerun_failed_jobs — a job red only on tests outside the change', () => {
	it('reruns the run once and records the failed tests as an observation', async () => {
		answer_checks([as_check(failed_unit())])
		answer_actions({ jobs: [failed_unit(), DETECT_E2E], log: UNIT_LOG })

		const names = await followup_job_rerun.rerun_failed_jobs(BRANCH_NAME)
		const entry = assess.mock.calls[0]?.[0].entry

		expect(names).toStrictEqual([UNIT_NAME, DETECT_E2E_NAME])
		expect(rerun_paths()).toStrictEqual([`${ACTIONS}runs/${String(RUN_ID)}/rerun-failed-jobs`])
		expect(api).toHaveBeenCalledWith({
			path: `${ACTIONS}jobs/${String(UNIT_ID)}/logs`,
			should_allow_escapes: true,
		})
		expect(entry?.where).toBe(OUTSIDE_TEST)
		expect(entry?.what).toContain(FAILED_TEST)
		expect(comment).toHaveBeenCalledWith('4813', expect.stringContaining(SIGHTING))
	})

	it.each([
		['the failed test is in the change', [OUTSIDE_TEST], 1, UNIT_LOG],
		[
			'its subject module is in the change',
			['scripts/run/board/run-board-frame-budget.ts'],
			1,
			UNIT_LOG,
		],
		['the run was already rerun once', [], 2, UNIT_LOG],
		['the log names no failed test', [], 1, 'Error: lint failed\n'],
	])('does not rerun when %s', async (_label, changed, run_attempt, log) => {
		read_changed.mockResolvedValue(changed)
		answer_checks([as_check(failed_unit(run_attempt))])
		answer_actions({ jobs: [failed_unit(run_attempt)], log })

		await expect_no_rerun()
		expect(assess).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#6673: the runner timed out fetching `pnpm/setup` and no test ran, yet `followup`
// stopped the lane on the red job; joshuafolkken/kit#6748: the same for a setup `curl` answered 504.
const ARCHIVE = `'https://codeload.github.com/pnpm/setup/tar.gz/a0881977'`

// A repository step that prints the same words is still a failure of the change, and a client error
// is not one a rerun helps.
const NOT_DOWNLOAD_FAILURES = [
	[
		'whose own step printed the download failure',
		`2026-11-07T13:52:11.1370349Z Error: Failed to download archive ${ARCHIVE}\n`,
	],
	['whose curl got a client error', curl_failed(404)],
	['whose installer got a client error', installer_failed(404)],
	[
		'whose own step exited with code one after a server error',
		`${CURL_ERROR} 504\n${CURL_EXIT.replace('22.', '1.')}`,
	],
	[
		'whose installer retried successfully before a test failed',
		`${installer_failed(504).replace('exit code 1.', 'exit code 0.')}\n${UNIT_LOG}`,
	],
	[
		'whose curl got through on a retry and a test of the change failed',
		`${CURL_ERROR} 504\n${UNIT_LOG}`,
	],
]

describe('rerun_failed_jobs — a job red because a download failed', () => {
	it.each([
		[
			'the download timed out',
			`2026-11-07T13:52:11.1370349Z ##[error]Failed to download archive ${ARCHIVE} after 3 attempts.\n`,
		],
		[
			'the download could not be resolved',
			'2026-11-07T13:46:37.4787283Z ##[error]Failed to resolve action download info.\n',
		],
		['a setup curl got a server error', curl_failed(504)],
		['an installer reported a terminal server error', installer_failed(504)],
		[
			'the CodeQL bundle got a server error',
			'2026-11-08T10:12:01.0000000Z ##[error]Unable to download and extract CodeQL CLI: Unexpected HTTP response: 504\n',
		],
	])('reruns the run once when %s', async (_label, log) => {
		answer_checks([as_check(failed_unit())])
		answer_actions({ jobs: [failed_unit()], log })

		expect(await followup_job_rerun.rerun_failed_jobs(BRANCH_NAME)).toStrictEqual([UNIT_NAME])
		expect(rerun_paths()).toStrictEqual([`${ACTIONS}runs/${String(RUN_ID)}/rerun-failed-jobs`])
		expect(assess).not.toHaveBeenCalled()
	})

	it.each(NOT_DOWNLOAD_FAILURES)('does not rerun a job %s', async (_label, log) => {
		read_changed.mockResolvedValue([OUTSIDE_TEST])
		answer_checks([as_check(failed_unit())])
		answer_actions({ jobs: [failed_unit()], log })

		await expect_no_rerun()
	})
})

// joshuafolkken/kit#5316: a test main had already fixed was rerun on the old base before main came in.
describe('rerun_failed_jobs — a failed test main has since changed', () => {
	it('skips the rerun for a merge of main, then reruns once the merge left it red', async () => {
		merge_first.mockResolvedValueOnce(true)
		answer_checks([as_check(failed_unit())])
		answer_actions({ jobs: [failed_unit()], log: UNIT_LOG })

		await expect_no_rerun()
		expect(merge_first).toHaveBeenCalledWith([OUTSIDE_TEST], ISSUE_NUMBER)
		expect(assess).not.toHaveBeenCalled()

		answer_checks([as_check(failed_unit())])

		expect(await followup_job_rerun.rerun_failed_jobs(BRANCH_NAME)).toStrictEqual([UNIT_NAME])
		expect(rerun_paths()).toHaveLength(1)
	})
})

describe('rerun_failed_jobs — an observation that cannot be posted', () => {
	it('still reruns the run', async () => {
		comment.mockRejectedValue(new Error('HTTP 502'))
		answer_checks([as_check(failed_unit())])
		answer_actions({ jobs: [failed_unit()], log: UNIT_LOG })

		expect(await followup_job_rerun.rerun_failed_jobs(BRANCH_NAME)).toStrictEqual([UNIT_NAME])
		expect(rerun_paths()).toHaveLength(1)
	})
})

describe('rerun_failed_jobs — nothing to read, or a rerun refused', () => {
	it.each([
		['a check from another app', { id: DETECT_E2E_ID, name: 'CodeRabbit', conclusion: CANCELLED }],
		['a status context', { context: 'deploy', state: 'error' }],
	])('reads no job for %s', async (_label, item) => {
		answer_checks([item])

		expect(await followup_job_rerun.rerun_failed_jobs(BRANCH_NAME)).toStrictEqual([])
		expect(api).not.toHaveBeenCalled()
	})

	it('answers empty and reports a rerun the API refused', async () => {
		answer_checks([as_check(DETECT_E2E)])
		answer_actions({ jobs: [DETECT_E2E], is_rerun_refused: true })

		expect(await followup_job_rerun.rerun_failed_jobs(BRANCH_NAME)).toStrictEqual([])
		expect(console.info).toHaveBeenCalledWith(expect.stringContaining('⚠️ CI job rerun failed'))
	})
})
