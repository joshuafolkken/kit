import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_helpers } from '#scripts/gh/git-gh-helpers'
import { changed_paths } from '#scripts/git/changed-paths'
import { poll } from '#scripts/lib/poll'
import { z } from 'zod'
import {
	followup_failed_tests,
	KEPT_VERDICT,
	RERUN_VERDICT,
	UNNAMED_VERDICT,
	type FailedTests,
	type TestVerdict,
} from './followup-failed-tests'
import { followup_job_needs, type NeedsGraph } from './followup-job-needs'

// A GitHub Actions job whose every step succeeded can still end `cancelled` or `timed_out`: the runner
// stops reporting after the last step and the job's `timeout-minutes` cuts it off (joshuafolkken/kit#4813,
// two 3-second jobs cut at 2m0s). Nothing in the change caused it, so `followup` reruns such a job once
// — as `git-gh-retry.ts` retries a GitHub 5xx — rather than failing a pull request that is green.
//
// **A job red only on tests outside the change is rerun the same way** (joshuafolkken/kit#5171): a test
// the diff never touched failing under runner load stopped `followup` and waited for a relaunched
// session to type the rerun by hand. Only the run's first attempt qualifies, so a test that fails again
// stops `followup` as before, and each such rerun leaves an observation (`followup-failed-tests.ts`).
// A job that failed only for waiting on such a job is rerun with it (`followup-job-needs.ts`).
//
// The rerun endpoint reruns **every** failed job of a run, and GitHub refuses it while the run is still
// going. So each run is waited out first, and it is rerun only when every job that failed in it
// qualifies: a run holding a job that failed on the change itself is never rerun, or a test the change
// broke could be retried into a merge.

const FAILURE_CONCLUSION = 'failure'
const FAILED_CONCLUSIONS = [FAILURE_CONCLUSION, 'cancelled', 'timed_out'] as const
const FAILED_JOB_CONCLUSIONS: ReadonlySet<string> = new Set(FAILED_CONCLUSIONS)
const ACTIONS_APP_SLUG = 'github-actions'
const PASSING_STEP_CONCLUSIONS: ReadonlySet<string> = new Set(['success', 'skipped'])
const RUN_COMPLETED = 'completed'
const FIRST_ATTEMPT = 1

// The longest `timeout-minutes` in `ci.yml` is 10; a run still going past that is not one a rerun helps.
const COMPLETE_ATTEMPTS = 40
const COMPLETE_INTERVAL_MS = 15_000

// The rerun answers once the new attempt exists, but its check runs can trail it; a re-judge that read
// the failed run again would fail on the very job just rerun.
const REGISTER_ATTEMPTS = 10
const REGISTER_INTERVAL_MS = 3000

const failed_check_schema = z.looseObject({
	id: z.number(),
	conclusion: z.enum(FAILED_CONCLUSIONS),
	app: z.looseObject({ slug: z.literal(ACTIONS_APP_SLUG) }),
})

const rollup_schema = z.looseObject({ statusCheckRollup: z.array(z.unknown()) })

// REST answers `null` for a step that never finished; a test fixture may leave the field out.
const step_schema = z.looseObject({ conclusion: z.string().nullish() })

const job_schema = z.looseObject({
	id: z.number(),
	name: z.string(),
	run_id: z.number(),
	run_attempt: z.number().nullish(),
	conclusion: z.string().nullish(),
	steps: z.array(step_schema),
})

// `path` is the workflow file's, relative to the repository root.
const run_schema = z.looseObject({ status: z.string(), path: z.string().optional() })

const jobs_page_schema = z.looseObject({ jobs: z.array(job_schema) })

type Job = z.infer<typeof job_schema>

// A failed job and what its reading says, with the failed tests when its log named some.
interface Judged {
	job: Job
	verdict: TestVerdict
	tests?: FailedTests
}

function actions_api_path(rest: string): string {
	return `${git_gh_api_path.repo_api_path()}/actions/${rest}`
}

async function read_actions<T>(rest: string, schema: z.ZodType<T>): Promise<T> {
	const json = await git_gh_exec.exec_gh_api({ path: actions_api_path(rest) })

	return schema.parse(JSON.parse(json))
}

async function read_failed_check_ids(branch_name: string): Promise<Array<number>> {
	const { snapshot_json } = await git_gh_command.pr_get_checks_snapshot(branch_name)
	const rollup = rollup_schema.parse(JSON.parse(snapshot_json)).statusCheckRollup

	return rollup.flatMap((item) => {
		const parsed = failed_check_schema.safeParse(item)

		return parsed.success ? parsed.data.id : []
	})
}

// A check run of GitHub Actions has its job's id, which is how the job — and so its run — is found.
async function read_failed_run_ids(branch_name: string): Promise<Array<number>> {
	const ids = await read_failed_check_ids(branch_name)
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

function is_first_failure(job: Job): boolean {
	return (
		job.conclusion === FAILURE_CONCLUSION && (job.run_attempt ?? FIRST_ATTEMPT) <= FIRST_ATTEMPT
	)
}

// A job whose every step passed stopped on the runner; one red on its first attempt is judged by the
// failed tests its log names. The log endpoint redirects to the plain text, which `gh api` follows; a
// vitest log is colored.
async function judge_job(job: Job, changed: ReadonlySet<string>): Promise<Judged> {
	if (has_every_step_passed(job)) return { job, verdict: RERUN_VERDICT }
	if (!is_first_failure(job)) return { job, verdict: KEPT_VERDICT }

	const log = await git_gh_exec.exec_gh_api({
		path: actions_api_path(`jobs/${String(job.id)}/logs`),
		should_allow_escapes: true,
	})
	const tests = followup_failed_tests.read_failed_tests(log)

	return { job, verdict: followup_failed_tests.verdict_of(tests, changed), tests }
}

function is_red_on_tests({ verdict, tests }: Judged): boolean {
	return verdict === RERUN_VERDICT && tests !== undefined
}

// A job red with no test named qualifies only as one waiting on a job red on tests outside the change.
function settle_unnamed(judged: ReadonlyArray<Judged>, graph: NeedsGraph): Array<Judged> {
	const red_on_tests = judged.filter((entry) => is_red_on_tests(entry)).map(({ job }) => job.name)

	return judged.map((entry) => {
		if (entry.verdict !== UNNAMED_VERDICT) return entry

		const is_waiting = followup_job_needs.is_waiting_on(graph, entry.job.name, red_on_tests)

		return is_waiting ? { job: entry.job, verdict: RERUN_VERDICT } : entry
	})
}

// The workflow is read only when a job named no test; a run without its `path` waits on nothing.
async function read_needs_graph(
	run_id: number,
	judged: ReadonlyArray<Judged>,
): Promise<NeedsGraph> {
	if (judged.every(({ verdict }) => verdict !== UNNAMED_VERDICT)) return []

	const run = await read_actions(`runs/${String(run_id)}`, run_schema)

	return run.path === undefined ? [] : await followup_job_needs.read_graph(run.path)
}

// **The jobs the rerun would retry**, or `undefined` when the run must not be rerun: still going, or
// holding a failed job that does not qualify.
async function read_rerun_jobs(
	run_id: number,
	changed: ReadonlySet<string>,
): Promise<Array<Judged> | undefined> {
	if (!(await await_run_completed(run_id))) return undefined
	const { jobs } = await read_actions(
		`runs/${String(run_id)}/jobs?filter=latest&per_page=100`,
		jobs_page_schema,
	)
	const failed = jobs.filter((job) => FAILED_JOB_CONCLUSIONS.has(job.conclusion ?? ''))
	const judged = await Promise.all(failed.map(async (job) => await judge_job(job, changed)))
	const settled = settle_unnamed(judged, await read_needs_graph(run_id, judged))

	return settled.every(({ verdict }) => verdict === RERUN_VERDICT) ? settled : undefined
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
			const failed = await read_failed_check_ids(branch_name)

			return failed.every((id) => !rerun_ids.has(id))
		},
		{ attempts: REGISTER_ATTEMPTS, interval_ms: REGISTER_INTERVAL_MS },
	)
}

// Every run must qualify: rerunning some would still leave the pull request red on the others. The
// change is read once, and only when a run failed.
async function find_rerun_jobs(branch_name: string): Promise<Array<Judged>> {
	const run_ids = await read_failed_run_ids(branch_name)

	if (run_ids.length === 0) return []

	const changed = new Set(await changed_paths.read_changed_paths(false))
	const per_run = await Promise.all(
		run_ids.map(async (run_id) => await read_rerun_jobs(run_id, changed)),
	)

	return per_run.every((jobs) => jobs !== undefined) ? per_run.flat() : []
}

async function rerun(branch_name: string, entries: ReadonlyArray<Judged>): Promise<Array<string>> {
	const jobs = entries.map(({ job }) => job)
	const names = jobs.map((job) => job.name)

	console.info(
		`🔁 Rerunning CI jobs that stopped after every step passed or failed only outside the change: ${names.join(', ')}`,
	)
	await followup_failed_tests.record(
		entries.flatMap(({ job, tests }) => (tests === undefined ? [] : { job: job.name, tests })),
	)
	await rerun_runs([...new Set(jobs.map((job) => job.run_id))])
	await await_rerun_registered(branch_name, jobs)

	return names
}

// **Returns the names of the jobs it reran**, empty when there was none to rerun. A read or a rerun
// that fails is reported and answers empty: the rerun is a recovery, so the original failure stands.
async function rerun_failed_jobs(branch_name: string): Promise<Array<string>> {
	try {
		const entries = await find_rerun_jobs(branch_name)

		return entries.length === 0 ? [] : await rerun(branch_name, entries)
	} catch (error) {
		console.info(`⚠️ CI job rerun failed: ${git_gh_helpers.get_error_message_with_stderr(error)}`)

		return []
	}
}

const followup_job_rerun = {
	rerun_failed_jobs,
}

export { followup_job_rerun, COMPLETE_ATTEMPTS, REGISTER_ATTEMPTS }
