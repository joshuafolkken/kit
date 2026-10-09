import { z } from 'zod'

// A job skipped by its `if:` (or neutral) belongs to a run that succeeded; counting it would skip a
// lower tag whose release is still on its way.
const FAILED_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out', 'startup_failure'])
const RELEASE_RUN_TITLE = 'GitHub Release '
const RUN_SCHEMA = z.object({
	id: z.number(),
	display_title: z.string(),
	status: z.string().optional(),
	conclusion: z.string().nullable().optional(),
})
const JOB_SCHEMA = z.object({
	name: z.string(),
	status: z.string(),
	conclusion: z.string().nullable(),
})
const RUNS_SCHEMA = z.object({ workflow_runs: z.array(RUN_SCHEMA) })
const JOBS_SCHEMA = z.object({ jobs: z.array(JOB_SCHEMA) })

type Run = z.infer<typeof RUN_SCHEMA>
type PollState = 'ready' | 'failed' | 'pending'

// `read` answers a GET on a repository API path. `workflow` is the publish workflow and `jobs` the
// jobs in it whose failure counts (empty: every job). `release_run_workflow` is the workflow that
// creates a tag's release — the publish workflow itself when its run creates the release.
interface RunSource {
	read: (path: string) => Promise<unknown>
	workflow: string | undefined
	jobs: ReadonlyArray<string>
	release_run_workflow: string | undefined
}

function is_failed_job(job: z.infer<typeof JOB_SCHEMA>, names: ReadonlyArray<string>): boolean {
	if (job.status !== 'completed' || !FAILED_CONCLUSIONS.has(job.conclusion ?? '')) return false
	if (names.length === 0) return true

	return names.some((name) => job.name === name || job.name.startsWith(`${name} /`))
}

async function list_runs(source: RunSource, workflow_name: string): Promise<ReadonlyArray<Run>> {
	const workflow = encodeURIComponent(workflow_name)

	return RUNS_SCHEMA.parse(await source.read(`/actions/workflows/${workflow}/runs?per_page=100`))
		.workflow_runs
}

async function find_run(
	source: RunSource,
	workflow_name: string,
	title: string,
): Promise<Run | undefined> {
	const runs = await list_runs(source, workflow_name)

	return runs.find((item) => item.display_title === title)
}

async function has_failed_job(source: RunSource, run_id: number): Promise<boolean> {
	const { jobs } = JOBS_SCHEMA.parse(
		await source.read(`/actions/runs/${String(run_id)}/jobs?per_page=100`),
	)

	return jobs.some((job) => is_failed_job(job, source.jobs))
}

// A run started before its title named the tag may be at work on any tag.
function may_release(run: Run, tag: string): boolean {
	if (run.status === 'completed') return false

	return (
		run.display_title === `${RELEASE_RUN_TITLE}${tag}` ||
		!run.display_title.startsWith(RELEASE_RUN_TITLE)
	)
}

// Unset, nothing tells that a release is over, so the lower tag is waited for.
async function is_release_over(source: RunSource, tag: string): Promise<boolean> {
	const workflow = source.release_run_workflow
	if (workflow === undefined) return false
	if (workflow === source.workflow) return true

	const runs = await list_runs(source, workflow)

	return runs.every((run) => !may_release(run, tag))
}

// A lower tag whose publication failed, or finished while no release run is left at work on it,
// never gains a release, so waiting on it would hold every later one.
async function is_release_lost(source: RunSource, tag: string): Promise<boolean> {
	if (source.workflow === undefined) return false

	const run = await find_run(source, source.workflow, `Publish ${tag}`)
	if (!run) return false
	if (await has_failed_job(source, run.id)) return true

	return run.status === 'completed' && (await is_release_over(source, tag))
}

// A run not listed yet is pending too: the announcement that starts this release also starts the
// publication, so the release can ask before GitHub has queued that run.
async function publication_state(
	source: RunSource,
	workflow: string,
	tag: string,
): Promise<PollState> {
	const run = await find_run(source, workflow, `Publish ${tag}`)
	if (run?.status !== 'completed') return 'pending'

	return run.conclusion === 'success' ? 'ready' : 'failed'
}

const github_release_runs = { is_release_lost, publication_state }

export type { PollState, RunSource }
export { github_release_runs }
