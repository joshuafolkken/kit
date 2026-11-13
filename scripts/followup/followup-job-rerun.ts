import { stripVTControlCharacters } from 'node:util'
import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_helpers } from '#scripts/gh/git-gh-helpers'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_branch } from '#scripts/git/git-branch'
import { poll, POLL_BACKOFF } from '#scripts/lib/poll'
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
import { followup_main_move } from './followup-main-move'

// A GitHub Actions job whose every step succeeded can still end `cancelled` or `timed_out`: the runner
// stops reporting after the last step and the job's `timeout-minutes` cuts it off (joshuafolkken/kit#4813).
// Nothing in the change caused it, so `followup` reruns such a job once
// — as `git-gh-retry.ts` retries a GitHub 5xx — rather than failing a pull request that is green.
//
// **A job red only on tests outside the change is rerun the same way** (joshuafolkken/kit#5171): a test
// the diff never touched failing under runner load stopped `followup` and waited for a relaunched
// session to type the rerun by hand. Only the run's first attempt qualifies, so a test that fails again
// stops `followup` as before, and each such rerun leaves an observation (`followup-failed-tests.ts`).
// A job that failed only for waiting on such a job is rerun with it (`followup-job-needs.ts`).
//
// **A job red because the runner could not download an action is rerun too** (joshuafolkken/kit#6673):
// the download fails before the action's own steps run, whether in "Set up job" or in a composite step,
// so nothing in the change was exercised. The runner's own error line in the log tells it apart.
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

// A download that failed before the change ran: the runner's last word after its action download
// retries, or its failure to look the action up at all; a `curl` whose last retry got a server error
// and so ended its step — a retry that got through leaves its earlier error lines behind; the CodeQL
// bundle answered with a server error.
const DOWNLOAD_ERRORS = [
	/^\S+ ##\[error\]Failed to (?:download archive|resolve action download info)/mu,
	/^\S+ curl: \(22\) The requested URL returned error: 5\d\d\r?\n\S+ ##\[error\]Process completed with exit code 22\.$/mu,
	/^\S+ curl: \(22\) The requested URL returned error: 5\d\d\r?\n\S+ \[ERROR\] Failed to download from https:\/\/\S+\r?\n\S+ ##\[error\]Process completed with exit code 1\.$/mu,
	/^\S+ ##\[error\]Unable to download and extract CodeQL CLI: Unexpected HTTP response: 5\d\d$/mu,
]

// The longest `timeout-minutes` in `ci.yml` is 10; a run still going past that is not one a rerun helps.
// Each poll here backs off while its reading stays the same (`poll.ts`): the attempts and interval
// set its wait budget, not its cadence.
const COMPLETE_ATTEMPTS = 40
const COMPLETE_INTERVAL_MS = 15_000

// The rerun answers once the new attempt exists, but its check runs can trail it; a re-judge that read
// the failed run again would fail on the very job just rerun. The backoff starts at the interval:
// the shared first wait is longer than this whole budget.
const REGISTER_ATTEMPTS = 10
const REGISTER_INTERVAL_MS = 3000
const REGISTER_BACKOFF = { ...POLL_BACKOFF, initial_ms: REGISTER_INTERVAL_MS }

// A download outage outlasts a rerun at once (joshuafolkken/kit#6834): `followup` reruns up to
// `MAX_CHECK_RERUNS` times, the first at once and each later one after a wait that doubles. Past the cap
// it stops on `RERUNS_SPENT_MESSAGE`, which names the outage rather than the red checks.
const MAX_CHECK_RERUNS = 3
const RERUN_BACKOFF_MS = 120_000
const RERUN_BACKOFF_FACTOR = 2
const MS_PER_SECOND = 1000
const RERUNS_SPENT_MESSAGE = 'CI infrastructure failures outlasted every followup rerun'

const failed_check_schema = z.looseObject({
	id: z.number(),
	conclusion: z.enum(FAILED_CONCLUSIONS),
	app: z.looseObject({ slug: z.literal(ACTIONS_APP_SLUG) }),
})

const rollup_schema = z.looseObject({ statusCheckRollup: z.array(z.unknown()) })

// REST answers `null` for a step that never finished; a test fixture may leave the field out.
const step_schema = z.looseObject({ name: z.string().optional(), conclusion: z.string().nullish() })

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

async function await_run_completed(run_id: number): Promise<boolean> {
	let status = ''

	return await poll.poll_until(
		async () => {
			;({ status } = await read_actions(`runs/${String(run_id)}`, run_schema))

			return status === RUN_COMPLETED
		},
		{
			attempts: COMPLETE_ATTEMPTS,
			interval_ms: COMPLETE_INTERVAL_MS,
			backoff: { seen: () => status },
		},
	)
}

function has_every_step_passed(job: Job): boolean {
	if (job.steps.length === 0) return false

	return job.steps.every((step) => PASSING_STEP_CONCLUSIONS.has(step.conclusion ?? ''))
}

function is_first_attempt(job: Job): boolean {
	return (job.run_attempt ?? FIRST_ATTEMPT) <= FIRST_ATTEMPT
}

// The log endpoint redirects to the plain text, which `gh api` follows; a vitest log is colored.
async function read_job_log(job: Job): Promise<string> {
	return await git_gh_exec.exec_gh_api({
		path: actions_api_path(`jobs/${String(job.id)}/logs`),
		should_allow_escapes: true,
	})
}

function is_download_failure(log: string): boolean {
	const plain_log = stripVTControlCharacters(log)
	if (followup_failed_tests.read_failed_tests(plain_log).import_failure !== undefined) return false

	return DOWNLOAD_ERRORS.some((error) => error.test(plain_log))
}

// A job whose every step passed stopped on the runner; a red one is rerun on any attempt when its log
// shows a download failing (joshuafolkken/kit#6834), and on its first attempt only is otherwise judged
// by the failed tests its log names; a later one names none, left to `settle_unnamed`.
async function judge_job(job: Job, changed: ReadonlySet<string>): Promise<Judged> {
	if (has_every_step_passed(job)) return { job, verdict: RERUN_VERDICT }
	if (job.conclusion !== FAILURE_CONCLUSION) return { job, verdict: KEPT_VERDICT }

	const log = await read_job_log(job)
	if (is_download_failure(log)) return { job, verdict: RERUN_VERDICT }
	if (!is_first_attempt(job)) return { job, verdict: UNNAMED_VERDICT }
	const tests = followup_failed_tests.read_failed_tests(log)

	return { job, verdict: await followup_failed_tests.read_verdict(tests, changed), tests }
}

// A job red with no test named qualifies as a gate that failed though every job it needs succeeded, and
// on its first attempt only as one waiting on a job that is itself rerun, or on one the run never
// created (`run_jobs` holds every job of the run).
function is_infra_failure(
	job: Job,
	graph: NeedsGraph,
	reruns: ReadonlyArray<string>,
	run_jobs: ReadonlyArray<Job>,
): boolean {
	if (followup_job_needs.is_gate_of_successes(graph, job, run_jobs)) return true
	if (!is_first_attempt(job)) return false

	const names = run_jobs.map(({ name }) => name)

	return (
		followup_job_needs.is_waiting_on(graph, job.name, reruns) ||
		followup_job_needs.is_missing_need(graph, job.name, names)
	)
}

function settle_unnamed(
	judged: ReadonlyArray<Judged>,
	graph: NeedsGraph,
	run_jobs: ReadonlyArray<Job>,
): Array<Judged> {
	const reruns = judged
		.filter(({ verdict }) => verdict === RERUN_VERDICT)
		.map(({ job }) => job.name)

	return judged.map((entry) => {
		if (entry.verdict !== UNNAMED_VERDICT) return entry

		return is_infra_failure(entry.job, graph, reruns, run_jobs)
			? { job: entry.job, verdict: RERUN_VERDICT }
			: entry
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
	const graph = await read_needs_graph(run_id, judged)
	const settled = settle_unnamed(judged, graph, jobs)

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
	let failed: Array<number> = []

	await poll.poll_until(
		async () => {
			failed = await read_failed_check_ids(branch_name)

			return failed.every((id) => !rerun_ids.has(id))
		},
		{
			attempts: REGISTER_ATTEMPTS,
			interval_ms: REGISTER_INTERVAL_MS,
			backoff: { seen: () => failed.join(','), schedule: REGISTER_BACKOFF },
		},
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
		`🔁 Rerunning CI jobs that stopped after every step passed, failed on a download, or failed only outside the change: ${names.join(', ')}`,
	)
	await followup_failed_tests.record(
		entries.flatMap(({ job, tests }) => (tests === undefined ? [] : { job: job.name, tests })),
		git_branch.issue_from_branch(branch_name),
	)
	await rerun_runs([...new Set(jobs.map((job) => job.run_id))])
	await await_rerun_registered(branch_name, jobs)

	return names
}

// A failed test main has since changed is merged before any rerun (`followup-main-move.ts`).
async function should_merge_first(
	branch_name: string,
	entries: ReadonlyArray<Judged>,
): Promise<boolean> {
	const files = [...new Set(entries.flatMap(({ tests }) => tests?.files ?? []))]

	return await followup_main_move.should_merge_first(
		files,
		git_branch.issue_from_branch(branch_name),
	)
}

function rerun_delay_ms(round: number): number {
	return round === 0 ? 0 : RERUN_BACKOFF_MS * RERUN_BACKOFF_FACTOR ** (round - 1)
}

async function wait_before_rerun(round: number): Promise<void> {
	const delay_ms = rerun_delay_ms(round)
	if (delay_ms === 0) return

	console.info(
		`⏳ Waiting ${String(delay_ms / MS_PER_SECOND)}s before CI job rerun ${String(round + 1)}`,
	)
	await poll.sleep(delay_ms)
}

function report_rerun_error(error: unknown): Array<string> {
	console.info(`⚠️ CI job rerun failed: ${git_gh_helpers.get_error_message_with_stderr(error)}`)

	return []
}

// **Returns the names of the jobs it reran**, empty when there was none to rerun or main has to be
// merged first. A read or a rerun that fails is reported and answers empty: the rerun is a recovery,
// so the original failure stands. `round` counts the reruns before this one and sets its wait.
async function rerun_failed_jobs(branch_name: string, round = 0): Promise<Array<string>> {
	try {
		const entries = await find_rerun_jobs(branch_name)

		if (entries.length === 0 || (await should_merge_first(branch_name, entries))) return []
		await wait_before_rerun(round)

		return await rerun(branch_name, entries)
	} catch (error) {
		return report_rerun_error(error)
	}
}

// **The names of the jobs a rerun would retry**, read without rerunning: the red a spent cap leaves.
async function read_rerun_names(branch_name: string): Promise<Array<string>> {
	try {
		const entries = await find_rerun_jobs(branch_name)

		return entries.map(({ job }) => job.name)
	} catch (error) {
		return report_rerun_error(error)
	}
}

function reruns_spent_message(names: ReadonlyArray<string>): string {
	return `${RERUNS_SPENT_MESSAGE} (${String(MAX_CHECK_RERUNS)} reruns; still failing: ${names.join(', ')}). Rerun the failed jobs once CI recovers, then run followup again.`
}

const followup_job_rerun = {
	actions_api_path,
	read_actions,
	read_rerun_names,
	rerun_failed_jobs,
	reruns_spent_message,
}

export {
	followup_job_rerun,
	COMPLETE_ATTEMPTS,
	COMPLETE_INTERVAL_MS,
	MAX_CHECK_RERUNS,
	REGISTER_ATTEMPTS,
	REGISTER_INTERVAL_MS,
	RERUN_BACKOFF_MS,
	RERUNS_SPENT_MESSAGE,
}
