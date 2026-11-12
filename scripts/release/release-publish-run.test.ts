import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { release_publish_run } from './release-publish-run'

const VERSION = '1.342.0'
const RUN_ID = 39_108_200_869
const TITLE = 'Publish v1.342.0'
const RUNS_PATH = 'repos/{owner}/{repo}/actions/workflows/publish.yml/runs?per_page=100'
const JOBS_PATH = `/actions/runs/${String(RUN_ID)}/jobs`
const COMPLETED = 'completed'
const FAILURE = 'failure'
const SUCCESS = 'success'
const NPM_JOB = 'publish-npm'
const RELEASE_JOB = 'create-release'

// `jobs` undefined: the jobs read fails.
function given_runs(runs: ReadonlyArray<object>, jobs?: ReadonlyArray<object>): void {
	vi.spyOn(git_gh_exec, 'exec_gh_api').mockImplementation(async ({ path }) => {
		if (!path.includes(JOBS_PATH)) return JSON.stringify({ workflow_runs: runs })
		if (jobs === undefined) throw new Error('HTTP 500')

		return JSON.stringify({ jobs })
	})
}

function run(title: string, status: string, conclusion?: string): object {
	return { id: RUN_ID, display_title: title, status, conclusion }
}

function job(name: string, conclusion: string): object {
	return { name, status: COMPLETED, conclusion }
}

const FAILED_RUN = run(TITLE, COMPLETED, FAILURE)

afterEach(() => {
	vi.restoreAllMocks()
})

describe('release_publish_run.failed_run — a failed run', () => {
	it('names the Publish run of the tag once it has failed', async () => {
		given_runs([FAILED_RUN], [job(NPM_JOB, FAILURE)])

		expect(await release_publish_run.failed_run(VERSION)).toEqual({
			run_id: RUN_ID,
			failed_jobs: [NPM_JOB],
			npm_job_failed: true,
		})
		expect(git_gh_exec.exec_gh_api).toHaveBeenCalledWith({ path: RUNS_PATH })
	})

	it('names the failed jobs and clears npm when publish-npm passed', async () => {
		given_runs([FAILED_RUN], [job(NPM_JOB, SUCCESS), job(RELEASE_JOB, FAILURE)])

		expect(await release_publish_run.failed_run(VERSION)).toEqual({
			run_id: RUN_ID,
			failed_jobs: [RELEASE_JOB],
			npm_job_failed: false,
		})
	})

	it('counts npm as failed when the jobs cannot be read', async () => {
		given_runs([FAILED_RUN])

		expect(await release_publish_run.failed_run(VERSION)).toEqual({
			run_id: RUN_ID,
			failed_jobs: [],
			npm_job_failed: true,
		})
	})
})

describe('release_publish_run.failed_run — no failed run', () => {
	it.each([
		['the run of another tag failed', [run('Publish v1.341.0', COMPLETED, FAILURE)]],
		['the run is still at work', [run(TITLE, 'in_progress')]],
		['the run succeeded', [run(TITLE, COMPLETED, SUCCESS)]],
		['no run is listed yet', []],
	])('answers none when %s', async (_case, runs) => {
		given_runs(runs, [])

		expect(await release_publish_run.failed_run(VERSION)).toBeUndefined()
	})

	it('answers none when the runs cannot be read', async () => {
		vi.spyOn(git_gh_exec, 'exec_gh_api').mockRejectedValue(new Error('HTTP 404'))

		expect(await release_publish_run.failed_run(VERSION)).toBeUndefined()
	})
})
