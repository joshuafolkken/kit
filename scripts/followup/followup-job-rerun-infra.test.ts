import { beforeEach, describe, expect, it, vi } from 'vitest'
import { followup_job_rerun, RERUN_BACKOFF_MS } from './followup-job-rerun'
import {
	followup_job_rerun_fixture,
	SUCCESS,
	UNIT_ID,
	WORKFLOW_PATH,
} from './followup-job-rerun-fixture'

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
const read_graph = vi.mocked(followup_job_needs.read_graph)
const { answer_actions, answer_checks, as_check, job, rerun_paths } = followup_job_rerun_fixture
const { read_rerun_names, rerun_failed_jobs } = followup_job_rerun

const BRANCH_NAME = '6834-lane'
const UNIT_NAME = 'Unit Tests'
const CHECKS_NAME = 'Checks'
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
	followup_job_rerun_fixture.answer_closed_inputs()
	vi.mocked(git_gh_command.pr_get_checks_snapshot).mockReset()
	vi.mocked(git_gh_exec.exec_gh_api).mockReset()
	assess.mockReset()
	read_changed.mockReset().mockResolvedValue([])
	read_graph.mockReset().mockResolvedValue([])
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

// PR #5158: the aggregator `Checks` failed beside the shard, its log naming no test.
describe('rerun_failed_jobs — a job red only for waiting on a job red outside the change', () => {
	const checks = job({ id: 104, name: CHECKS_NAME, conclusion: FAILURE, steps: FAILED_STEPS })
	const lint = job({ id: 105, name: 'Lint', conclusion: SUCCESS })

	function answer_waiting(needs: string, log = UNIT_LOG): void {
		const graph = `jobs:\n  unit:\n    name: ${UNIT_NAME}\n  lint:\n    name: Lint\n  checks:\n    name: ${CHECKS_NAME}\n    needs: [${needs}]\n`

		read_graph.mockResolvedValue(followup_job_needs.parse_graph(graph))
		answer_checks([as_check(failed_unit(1)), as_check(checks)])
		answer_actions({ jobs: [failed_unit(1), lint, checks], log })
	}

	it('reruns it with a job it waits on that failed on a download', async () => {
		answer_waiting('unit', CURL_504)

		expect(await rerun_failed_jobs(BRANCH_NAME)).toStrictEqual([UNIT_NAME, CHECKS_NAME])
		expect(assess).not.toHaveBeenCalled()
	})

	it('reruns it with the job it waits on, reading the run workflow', async () => {
		answer_waiting('lint, unit')

		expect(await rerun_failed_jobs(BRANCH_NAME)).toStrictEqual([UNIT_NAME, CHECKS_NAME])
		expect(read_graph).toHaveBeenCalledWith(WORKFLOW_PATH)
		expect(assess.mock.calls[0]?.[0].entry.what).toContain(`followup reran ${UNIT_NAME};`)
	})

	it('does not rerun when it waits on no such job', async () => {
		answer_waiting('lint')

		expect(await rerun_failed_jobs(BRANCH_NAME)).toStrictEqual([])
		expect(rerun_paths()).toStrictEqual([])
	})
})

// joshuafolkken/kit#6923: SonarQube ran without its `change-scope`, so only its guard step failed.
describe('rerun_failed_jobs — a job whose needed job the run lacks', () => {
	const SONAR_NAME = 'SonarQube'
	const GUARD_LOG = '2026-11-10T01:00:00.0000000Z ##[error]Process completed with exit code 1.\n'
	const sonar = job({ id: UNIT_ID, name: SONAR_NAME, conclusion: FAILURE, steps: FAILED_STEPS })
	const graph = `jobs:\n  change-scope:\n    name: Change scope\n  sonarqube:\n    name: ${SONAR_NAME}\n    needs: change-scope\n`

	beforeEach(() => {
		read_graph.mockResolvedValue(followup_job_needs.parse_graph(graph))
		answer_checks([as_check(sonar)])
	})

	it('reruns the job when the run never created the job it needs', async () => {
		answer_actions({ jobs: [sonar], log: GUARD_LOG })

		expect(await rerun_failed_jobs(BRANCH_NAME)).toStrictEqual([SONAR_NAME])
		expect(rerun_paths()).toHaveLength(1)
	})

	it('does not rerun the job when the job it needs ran and failed', async () => {
		const scope = job({ id: 106, name: 'Change scope', conclusion: FAILURE, steps: FAILED_STEPS })

		answer_actions({ jobs: [scope, sonar], log: GUARD_LOG })

		expect(await rerun_failed_jobs(BRANCH_NAME)).toStrictEqual([])
		expect(rerun_paths()).toStrictEqual([])
	})
})

const GATE_STEP = 'Require both halves of the verification gate'
const GATE_LOG = '2026-11-10T01:00:00.0000000Z ##[error]the Node build matrix did not pass\n'
const GATE_GRAPH = `jobs:\n  lint:\n    name: Lint\n  checks:\n    name: ${CHECKS_NAME}\n    needs: lint\n    steps:\n      - name: ${GATE_STEP}\n        env:\n          LINT_RESULT: \${{ needs.lint.result }}\n`

function answer_gate(lint_conclusion: string, run_attempt = 1): void {
	const checks = {
		...job({ id: UNIT_ID, name: CHECKS_NAME, conclusion: FAILURE, run_attempt }),
		steps: [
			{ name: 'Set up job', conclusion: SUCCESS },
			{ name: GATE_STEP, conclusion: FAILURE },
		],
	}

	read_graph.mockResolvedValue(followup_job_needs.parse_graph(GATE_GRAPH))
	answer_checks([as_check(checks)])
	answer_actions({
		jobs: [
			job({ id: 105, name: 'Lint', conclusion: lint_conclusion, steps: [lint_conclusion] }),
			checks,
		],
		log: GATE_LOG,
	})
}

// joshuafolkken/kit#6924: `Checks` read `abandoned` for needs that had succeeded and failed its gate.
describe('rerun_failed_jobs — a gate failed though every job it needs succeeded', () => {
	it.each([
		[SUCCESS, 1],
		[SUCCESS, SECOND_ATTEMPT],
		['skipped', 1],
	])('reruns the gate whose need ended %s on attempt %i', async (lint_conclusion, run_attempt) => {
		answer_gate(lint_conclusion, run_attempt)

		expect(await rerun_failed_jobs(BRANCH_NAME)).toStrictEqual([CHECKS_NAME])
		expect(rerun_paths()).toHaveLength(1)
	})

	it('does not rerun the gate when a job it needs failed', async () => {
		answer_gate(FAILURE)

		expect(await rerun_failed_jobs(BRANCH_NAME)).toStrictEqual([])
		expect(rerun_paths()).toStrictEqual([])
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
