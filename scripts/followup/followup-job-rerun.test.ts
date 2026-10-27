import type { GhApiRequest } from '#scripts/gh/git-gh-exec'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPLETE_ATTEMPTS, followup_job_rerun, REGISTER_ATTEMPTS } from './followup-job-rerun'

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
	observation_record: { record: vi.fn() },
}))

vi.mock(import('./followup-job-needs'), async (import_original) => {
	const actual = await import_original()

	return { followup_job_needs: { ...actual.followup_job_needs, read_graph: vi.fn() } }
})

const { git_gh_command } = await import('#scripts/gh/git-gh-command')
const { git_gh_exec } = await import('#scripts/gh/git-gh-exec')
const { changed_paths } = await import('#scripts/git/changed-paths')
const { observation_record } = await import('#scripts/observations/observation-record')
const { followup_job_needs } = await import('./followup-job-needs')

const fetch_checks = vi.mocked(git_gh_command.pr_get_checks_snapshot)
const api = vi.mocked(git_gh_exec.exec_gh_api)
const read_changed = vi.mocked(changed_paths.read_changed_paths)
const record = vi.mocked(observation_record.record)
const read_graph = vi.mocked(followup_job_needs.read_graph)

const BRANCH_NAME = '4813-lane'
const PR_NUMBER = 4811
const RUN_ID = 40_117_183_013
const OTHER_RUN_ID = 40_117_183_014
const ACTIONS = 'repos/{owner}/{repo}/actions/'
const CANCELLED = 'cancelled'
const SUCCESS = 'success'
const PASSED_STEPS = [SUCCESS, 'skipped', SUCCESS]
const DETECT_E2E_NAME = 'Detect E2E'
const PLAYWRIGHT_NAME = 'Resolve Playwright image'
const UNIT_NAME = 'Unit Tests'
const DETECT_E2E_ID = 101
const UNIT_ID = 103

const FAILURE = 'failure'
const FAILED_STEPS = [SUCCESS, FAILURE]
const OUTSIDE_TEST = 'scripts/run/board/run-board-frame-budget.test.ts'
const FAILED_TEST = `${OUTSIDE_TEST} > frame budget > reads the budget`
const UNIT_LOG = `2026-10-27T10:00:00.0000000Z  FAIL  ${FAILED_TEST}\n`
const WORKFLOW_PATH = '.github/workflows/ci.yml'
const CHECKS_NAME = 'Checks'

interface JobInput {
	id: number
	name: string
	conclusion: string
	steps?: Array<string | undefined>
	run_id?: number
	run_attempt?: number
}

function job(input: JobInput): object {
	const { steps = PASSED_STEPS, run_id = RUN_ID, ...rest } = input

	return { ...rest, run_id, steps: steps.map((conclusion) => ({ conclusion })) }
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

function as_check(item: object): object {
	return { ...item, app: { slug: 'github-actions' } }
}

function snapshot_of(rollup: Array<object>): { pr_number: number; snapshot_json: string } {
	return { pr_number: PR_NUMBER, snapshot_json: JSON.stringify({ statusCheckRollup: rollup }) }
}

// The first read finds the stalled checks; every later read — the registration wait — sees the
// rerun's queued runs in their place unless told otherwise.
function answer_checks(first: Array<object>, later: Array<object> = []): void {
	fetch_checks.mockResolvedValueOnce(snapshot_of(first)).mockResolvedValue(snapshot_of(later))
}

interface ActionsWorld {
	jobs: Array<object>
	statuses?: Array<string>
	is_rerun_refused?: boolean
	log?: string
}

function find_job(jobs: Array<object>, path: string): object | undefined {
	return jobs.find((item) => path.endsWith(`/jobs/${String(Reflect.get(item, 'id'))}`))
}

function answer_run(world: ActionsWorld, path: string): string {
	if (!path.includes('/jobs?')) {
		return JSON.stringify({ status: world.statuses?.shift() ?? 'completed', path: WORKFLOW_PATH })
	}

	const run_id = Number(/runs\/(\d+)\//u.exec(path)?.[1])

	return JSON.stringify({
		jobs: world.jobs.filter((item) => Reflect.get(item, 'run_id') === run_id),
	})
}

function answer_read(world: ActionsWorld, path: string): string {
	if (path.endsWith('/logs')) {
		return path.includes(`/jobs/${String(UNIT_ID)}/`) ? (world.log ?? '') : ''
	}

	const found = find_job(world.jobs, path)
	if (found !== undefined) return JSON.stringify(found)

	return answer_run(world, path)
}

// Answers the Actions REST reads from one picture of the world; a POST is the rerun itself.
function answer_actions(world: ActionsWorld): void {
	api.mockImplementation(async (request: GhApiRequest) => {
		if (request.method !== 'POST') return answer_read(world, request.path)
		if (world.is_rerun_refused === true) throw new Error('HTTP 403')

		return ''
	})
}

function rerun_paths(): Array<string> {
	return api.mock.calls
		.filter(([request]) => request.method === 'POST')
		.map(([request]) => request.path)
}

async function rerun_with_timers(): Promise<Array<string>> {
	vi.useFakeTimers()
	const pending = followup_job_rerun.rerun_failed_jobs(BRANCH_NAME)

	await vi.runAllTimersAsync()
	const names = await pending

	vi.useRealTimers()

	return names
}

async function expect_no_rerun(): Promise<void> {
	expect(await followup_job_rerun.rerun_failed_jobs(BRANCH_NAME)).toStrictEqual([])
	expect(rerun_paths()).toStrictEqual([])
}

beforeEach(() => {
	fetch_checks.mockReset()
	api.mockReset()
	record.mockReset().mockResolvedValue({ verdict: 'refused', reason: 'not written in a test' })
	read_changed.mockReset().mockResolvedValue(['scripts/followup/followup-job-rerun.ts'])
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
			`🔁 Rerunning CI jobs that stopped after every step passed or failed only outside the change: ${DETECT_E2E_NAME}, ${PLAYWRIGHT_NAME}`,
		)
		expect(record).not.toHaveBeenCalled()
	})

	// GitHub refuses a rerun while the run is still going, and the gate fails on the first red check.
	it('waits for the run to complete before rerunning it', async () => {
		answer_checks([as_check(DETECT_E2E)])
		answer_actions({ jobs: [DETECT_E2E], statuses: ['in_progress', 'in_progress'] })

		expect(await rerun_with_timers()).toStrictEqual([DETECT_E2E_NAME])
		expect(rerun_paths()).toHaveLength(1)
	})

	it('does not rerun a run that never completes', async () => {
		const statuses = Array.from({ length: COMPLETE_ATTEMPTS }, () => 'queued')

		answer_checks([as_check(DETECT_E2E)])
		answer_actions({ jobs: [DETECT_E2E], statuses })

		expect(await rerun_with_timers()).toStrictEqual([])
		expect(rerun_paths()).toStrictEqual([])
	})

	it('waits until the rerun replaced the stalled check runs', async () => {
		answer_checks([as_check(DETECT_E2E)], [as_check(DETECT_E2E)])
		answer_actions({ jobs: [DETECT_E2E] })

		await rerun_with_timers()

		expect(fetch_checks).toHaveBeenCalledTimes(1 + REGISTER_ATTEMPTS)
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
		const entry = record.mock.calls[0]?.[0].entry

		expect(names).toStrictEqual([UNIT_NAME, DETECT_E2E_NAME])
		expect(rerun_paths()).toStrictEqual([`${ACTIONS}runs/${String(RUN_ID)}/rerun-failed-jobs`])
		expect(api).toHaveBeenCalledWith({
			path: `${ACTIONS}jobs/${String(UNIT_ID)}/logs`,
			should_allow_escapes: true,
		})
		expect(entry?.where).toBe(OUTSIDE_TEST)
		expect(entry?.what).toContain(FAILED_TEST)
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
		expect(record).not.toHaveBeenCalled()
	})
})

// PR #5158: the aggregator `Checks` failed beside the shard, its log naming no test.
describe('rerun_failed_jobs — a job red only for waiting on a job red outside the change', () => {
	const checks = job({ id: 104, name: CHECKS_NAME, conclusion: FAILURE, steps: FAILED_STEPS })

	function answer_waiting(needs: string): void {
		const workflow = `jobs:\n  unit:\n    name: ${UNIT_NAME}\n  lint:\n    name: Lint\n  checks:\n    name: ${CHECKS_NAME}\n    needs: [${needs}]\n`

		read_graph.mockResolvedValue(followup_job_needs.parse_graph(workflow))
		answer_checks([as_check(failed_unit()), as_check(checks)])
		answer_actions({ jobs: [failed_unit(), checks], log: UNIT_LOG })
	}

	it('reruns it with the job it waits on, reading the run workflow', async () => {
		answer_waiting('lint, unit')

		expect(await followup_job_rerun.rerun_failed_jobs(BRANCH_NAME)).toStrictEqual([
			UNIT_NAME,
			CHECKS_NAME,
		])
		expect(read_graph).toHaveBeenCalledWith(WORKFLOW_PATH)
		expect(record.mock.calls[0]?.[0].entry.what).toContain(`followup reran ${UNIT_NAME};`)
	})

	it('does not rerun when it waits on no such job', async () => {
		answer_waiting('lint')

		await expect_no_rerun()
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
