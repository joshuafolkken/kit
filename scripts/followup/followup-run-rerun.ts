import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_helpers } from '#scripts/gh/git-gh-helpers'
import { is_required_match, type MissingContexts } from '#scripts/gh/git-pr-checks-missing'
import { poll } from '#scripts/lib/poll'
import { z } from 'zod'
import { followup_job_rerun } from './followup-job-rerun'

// **A required job a partial rerun dropped from its run's latest attempt** (joshuafolkken/kit#5778)
// leaves no failed job for `rerun-failed-jobs` to retry, so the wait's `MissingContextError` is
// answered by rerunning the whole run that lost it — the run whose `filter=all` jobs hold the context
// and whose `filter=latest` jobs do not. A context no job of the head's runs ever had (an outside
// app's check) is not ours to recover, and a run with a failed latest job is not rerun, or a test the
// change broke could be retried into a merge.
//
// **A run that ended `failure` with no failed job** (joshuafolkken/kit#6677) never created its
// remaining jobs, so no attempt of any run holds the missing contexts. Such an abandoned run is rerun
// whole for every missing context. A `dynamic` run (GitHub's own CodeQL setup) holds none of ours.

const PAGE = 'per_page=100'
const FAILED_CONCLUSIONS: ReadonlySet<string> = new Set(['failure', 'cancelled', 'timed_out'])
const RUN_FAILURE = 'failure'
const EVENT_DYNAMIC = 'dynamic'

// A `needs:`-gated job appears only once its prerequisites finish, and the longest `timeout-minutes`
// in `ci.yml` is 10. The poll backs off while the latest jobs stay the same (`poll.ts`).
const LATEST_ATTEMPTS = 40
const LATEST_INTERVAL_MS = 15_000

const job_schema = z.looseObject({ name: z.string(), conclusion: z.string().nullish() })
const jobs_page_schema = z.looseObject({ jobs: z.array(job_schema) })
const run_schema = z.looseObject({
	id: z.number(),
	conclusion: z.string().nullish(),
	event: z.string().nullish(),
})
const runs_page_schema = z.looseObject({ workflow_runs: z.array(run_schema) })

type Job = z.infer<typeof job_schema>

interface RunJobs {
	run_id: number
	is_abandoned: boolean
	all: Array<Job>
	latest: Array<Job>
}

// `present`: every lost job is back in a latest attempt — its creation only trailed — so the wait is
// judged again with no rerun; `none`: nothing here recovers it.
type MissingOutcome = 'present' | 'rerun' | 'none'

async function read_jobs(run_id: number, filter: 'all' | 'latest'): Promise<Array<Job>> {
	const rest = `runs/${String(run_id)}/jobs?filter=${filter}&${PAGE}`
	const { jobs } = await followup_job_rerun.read_actions(rest, jobs_page_schema)

	return jobs
}

function has_failed_job(jobs: ReadonlyArray<Job>): boolean {
	return jobs.some((job) => FAILED_CONCLUSIONS.has(job.conclusion ?? ''))
}

async function read_run_jobs(head_sha: string): Promise<Array<RunJobs>> {
	const rest = `runs?head_sha=${head_sha}&${PAGE}`
	const { workflow_runs } = await followup_job_rerun.read_actions(rest, runs_page_schema)

	return await Promise.all(
		workflow_runs.map(async ({ id, conclusion, event }) => {
			const latest = await read_jobs(id, 'latest')
			const is_failed = conclusion === RUN_FAILURE && event !== EVENT_DYNAMIC

			return {
				run_id: id,
				is_abandoned: is_failed && !has_failed_job(latest),
				all: await read_jobs(id, 'all'),
				latest,
			}
		}),
	)
}

function holds(jobs: ReadonlyArray<Job>, context: string): boolean {
	return jobs.some((job) => is_required_match(job.name, context))
}

function holds_every(jobs: ReadonlyArray<Job>, contexts: ReadonlyArray<string>): boolean {
	return contexts.every((context) => holds(jobs, context))
}

function is_rerun_target(run: RunJobs, lost: ReadonlyArray<string>): boolean {
	if (run.is_abandoned) return true
	if (has_failed_job(run.latest)) return false

	return lost.some((context) => holds(run.all, context) && !holds(run.latest, context))
}

function could_hold(run: RunJobs, context: string): boolean {
	return run.is_abandoned || holds(run.all, context)
}

async function await_latest_jobs(
	runs: ReadonlyArray<RunJobs>,
	lost: ReadonlyArray<string>,
): Promise<void> {
	let latest: Array<Job> = []

	await poll.poll_until(
		async () => {
			const per_run = await Promise.all(
				runs.map(async ({ run_id }) => await read_jobs(run_id, 'latest')),
			)

			latest = per_run.flat()

			return holds_every(latest, lost)
		},
		{
			attempts: LATEST_ATTEMPTS,
			interval_ms: LATEST_INTERVAL_MS,
			backoff: {
				seen: () => JSON.stringify(latest.map(({ name, conclusion }) => [name, conclusion])),
			},
		},
	)
}

// One request per run, not retried: a rerun that landed before a transient failure would be
// refused the second time.
async function rerun_whole(
	runs: ReadonlyArray<RunJobs>,
	lost: ReadonlyArray<string>,
): Promise<void> {
	console.info(`🔁 Rerunning the whole CI run that lost required jobs: ${lost.join(', ')}`)
	await Promise.all(
		runs.map(
			async ({ run_id }) =>
				await git_gh_exec.exec_gh_api({
					path: followup_job_rerun.actions_api_path(`runs/${String(run_id)}/rerun`),
					method: 'POST',
					should_retry: false,
				}),
		),
	)
	await await_latest_jobs(runs, lost)
}

async function recover(missing: MissingContexts): Promise<MissingOutcome> {
	const runs = await read_run_jobs(missing.head_sha)
	const lost = missing.contexts.filter((context) => runs.some((run) => could_hold(run, context)))
	if (lost.length === 0) return 'none'
	const latest = runs.flatMap((run) => run.latest)
	if (holds_every(latest, lost)) return 'present'
	const targets = runs.filter((run) => is_rerun_target(run, lost))
	if (targets.length === 0) return 'none'
	const rerun = lost.filter((context) => targets.some((run) => could_hold(run, context)))

	await rerun_whole(targets, rerun)

	return 'rerun'
}

// A read or a rerun that fails is reported and answers `none`: the rerun is a recovery, so the
// failure is left to the failed-job rerun, and stands where that finds nothing.
async function recover_missing(missing: MissingContexts): Promise<MissingOutcome> {
	try {
		return await recover(missing)
	} catch (error) {
		console.info(`⚠️ CI run rerun failed: ${git_gh_helpers.get_error_message_with_stderr(error)}`)

		return 'none'
	}
}

const followup_run_rerun = {
	recover_missing,
}

export { followup_run_rerun, LATEST_ATTEMPTS, LATEST_INTERVAL_MS }
