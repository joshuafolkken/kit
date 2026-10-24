import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_helpers } from '#scripts/gh/git-gh-helpers'
import { poll } from '#scripts/lib/poll'
import { z } from 'zod'

// A GitHub Actions job whose every step succeeded can still end `cancelled` or `timed_out`: the runner
// stops reporting after the last step and the job's `timeout-minutes` cuts it off (joshuafolkken/kit#4813,
// two 3-second jobs cut at 2m0s). Nothing in the change caused it, so `followup` reruns such a job once
// — as `git-gh-retry.ts` retries a GitHub 5xx — rather than failing a pull request that is green.
//
// The rerun endpoint reruns **every** failed job of a run, and GitHub refuses it while the run is still
// going. So each run is waited out first, and it is rerun only when every job that failed in it passed
// all its steps: a run holding a job that failed on its own is never rerun, or a flaky test could be
// retried into a merge.

const STALLED_CONCLUSIONS = ['cancelled', 'timed_out'] as const
const FAILED_JOB_CONCLUSIONS: ReadonlySet<string> = new Set(['failure', ...STALLED_CONCLUSIONS])
const ACTIONS_APP_SLUG = 'github-actions'
const PASSING_STEP_CONCLUSIONS: ReadonlySet<string> = new Set(['success', 'skipped'])
const RUN_COMPLETED = 'completed'

// The longest `timeout-minutes` in `ci.yml` is 10; a run still going past that is not one a rerun helps.
const COMPLETE_ATTEMPTS = 40
const COMPLETE_INTERVAL_MS = 15_000

// The rerun answers once the new attempt exists, but its check runs can trail it; a re-judge that read
// the cancelled run again would fail on the very job just rerun.
const REGISTER_ATTEMPTS = 10
const REGISTER_INTERVAL_MS = 3000

const stalled_check_schema = z.looseObject({
	id: z.number(),
	conclusion: z.enum(STALLED_CONCLUSIONS),
	app: z.looseObject({ slug: z.literal(ACTIONS_APP_SLUG) }),
})

const rollup_schema = z.looseObject({ statusCheckRollup: z.array(z.unknown()) })

// REST answers `null` for a step that never finished; a test fixture may leave the field out.
const step_schema = z.looseObject({ conclusion: z.string().nullish() })

const job_schema = z.looseObject({
	id: z.number(),
	name: z.string(),
	run_id: z.number(),
	conclusion: z.string().nullish(),
	steps: z.array(step_schema),
})

const run_schema = z.looseObject({ status: z.string() })

const jobs_page_schema = z.looseObject({ jobs: z.array(job_schema) })

type Job = z.infer<typeof job_schema>

function actions_api_path(rest: string): string {
	return `${git_gh_api_path.repo_api_path()}/actions/${rest}`
}

async function read_actions<T>(rest: string, schema: z.ZodType<T>): Promise<T> {
	const json = await git_gh_exec.exec_gh_api({ path: actions_api_path(rest) })

	return schema.parse(JSON.parse(json))
}

async function read_stalled_check_ids(branch_name: string): Promise<Array<number>> {
	const { snapshot_json } = await git_gh_command.pr_get_checks_snapshot(branch_name)
	const rollup = rollup_schema.parse(JSON.parse(snapshot_json)).statusCheckRollup

	return rollup.flatMap((item) => {
		const parsed = stalled_check_schema.safeParse(item)

		return parsed.success ? parsed.data.id : []
	})
}

// A check run of GitHub Actions has its job's id, which is how the job — and so its run — is found.
async function read_stalled_run_ids(branch_name: string): Promise<Array<number>> {
	const ids = await read_stalled_check_ids(branch_name)
	const jobs = await Promise.all(
		ids.map(async (id) => await read_actions(`jobs/${String(id)}`, job_schema)),
	)

	return [...new Set(jobs.map((job) => job.run_id))]
}

async function is_run_completed(run_id: number): Promise<boolean> {
	const run = await read_actions(`runs/${String(run_id)}`, run_schema)

	return run.status === RUN_COMPLETED
}

async function await_run_completed(run_id: number): Promise<boolean> {
	return await poll.poll_until(async () => await is_run_completed(run_id), {
		attempts: COMPLETE_ATTEMPTS,
		interval_ms: COMPLETE_INTERVAL_MS,
	})
}

function has_every_step_passed(job: Job): boolean {
	if (job.steps.length === 0) return false

	return job.steps.every((step) => PASSING_STEP_CONCLUSIONS.has(step.conclusion ?? ''))
}

// **The jobs the rerun would retry**, or `undefined` when the run must not be rerun: still going, or
// holding a failed job that did not pass every step.
async function read_rerun_jobs(run_id: number): Promise<Array<Job> | undefined> {
	if (!(await await_run_completed(run_id))) return undefined
	const { jobs } = await read_actions(
		`runs/${String(run_id)}/jobs?filter=latest&per_page=100`,
		jobs_page_schema,
	)
	const failed = jobs.filter((job) => FAILED_JOB_CONCLUSIONS.has(job.conclusion ?? ''))

	return failed.every((job) => has_every_step_passed(job)) ? failed : undefined
}

// One request per run, not retried: a rerun that landed before a transient failure would be refused
// the second time.
async function rerun_runs(run_ids: ReadonlyArray<number>): Promise<void> {
	await Promise.all(
		run_ids.map(
			async (run_id) =>
				await git_gh_exec.exec_gh_api({
					path: actions_api_path(`runs/${String(run_id)}/rerun-failed-jobs`),
					method: 'POST',
					should_retry: false,
				}),
		),
	)
}

async function await_rerun_registered(
	branch_name: string,
	jobs: ReadonlyArray<Job>,
): Promise<void> {
	const rerun_ids = new Set(jobs.map((job) => job.id))

	await poll.poll_until(
		async () => {
			const stalled = await read_stalled_check_ids(branch_name)

			return stalled.every((id) => !rerun_ids.has(id))
		},
		{ attempts: REGISTER_ATTEMPTS, interval_ms: REGISTER_INTERVAL_MS },
	)
}

// Every run must qualify: rerunning some would still leave the pull request red on the others.
async function find_rerun_jobs(branch_name: string): Promise<Array<Job>> {
	const run_ids = await read_stalled_run_ids(branch_name)
	const per_run = await Promise.all(run_ids.map(async (run_id) => await read_rerun_jobs(run_id)))

	return per_run.every((jobs) => jobs !== undefined) ? per_run.flat() : []
}

async function rerun(branch_name: string, jobs: ReadonlyArray<Job>): Promise<Array<string>> {
	const names = jobs.map((job) => job.name)

	console.info(`🔁 Rerunning CI jobs that stopped after every step passed: ${names.join(', ')}`)
	await rerun_runs([...new Set(jobs.map((job) => job.run_id))])
	await await_rerun_registered(branch_name, jobs)

	return names
}

// **Returns the names of the jobs it reran**, empty when there was none to rerun. A read or a rerun
// that fails is reported and answers empty: the rerun is a recovery, so the original failure stands.
async function rerun_stalled_jobs(branch_name: string): Promise<Array<string>> {
	try {
		const jobs = await find_rerun_jobs(branch_name)

		return jobs.length === 0 ? [] : await rerun(branch_name, jobs)
	} catch (error) {
		console.info(`⚠️ CI job rerun failed: ${git_gh_helpers.get_error_message_with_stderr(error)}`)

		return []
	}
}

const followup_job_rerun = {
	rerun_stalled_jobs,
}

export { followup_job_rerun, COMPLETE_ATTEMPTS, REGISTER_ATTEMPTS }
