import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { z } from 'zod'
import { ci_timing_table, type JobTiming } from './ci-timing-table'

// Resolves `josh ci:timing`'s one argument to GitHub Actions runs and reads each run's jobs. A run
// id is ten digits and more, a pull request number never near a hundred million, so one number
// names either without a flag; anything else is a branch name.

const RUN_ID_FLOOR = 100_000_000
const DIGITS = /^\d+$/u
const JOBS_PER_PAGE = 100
// Wide enough to hold every workflow one push starts.
const RUNS_PER_PAGE = 20

const pull_schema = z.looseObject({ head: z.looseObject({ ref: z.string() }) })

const run_schema = z.looseObject({
	id: z.number(),
	name: z.string().nullish(),
	conclusion: z.string().nullish(),
	head_sha: z.string(),
	html_url: z.string(),
})

const runs_page_schema = z.looseObject({ workflow_runs: z.array(run_schema) })

type Run = z.infer<typeof run_schema>

type Target =
	{ kind: 'run'; run_id: number } | { kind: 'pr'; pr: number } | { kind: 'branch'; branch: string }

interface RunTiming {
	run: Run
	jobs: Array<JobTiming>
}

// The runs timed, or `none` naming what was looked for when no run exists.
type TimingAnswer = { kind: 'timed'; runs: Array<RunTiming> } | { kind: 'none'; target: string }

function target_of(argument: string): Target {
	if (!DIGITS.test(argument)) return { kind: 'branch', branch: argument }

	const value = Number(argument)

	return value >= RUN_ID_FLOOR ? { kind: 'run', run_id: value } : { kind: 'pr', pr: value }
}

async function read_json(rest: string): Promise<unknown> {
	const json = await git_gh_exec.exec_gh_api({ path: `${git_gh_api_path.repo_api_path()}/${rest}` })

	return JSON.parse(json)
}

async function branch_of_pr(pr: number): Promise<string> {
	return pull_schema.parse(await read_json(`pulls/${String(pr)}`)).head.ref
}

// Every run on the branch's latest commit, newest first: one push starts a run per workflow, so the
// newest run alone can be a seconds-long side workflow rather than the CI run being measured.
async function latest_runs_of(branch: string): Promise<Array<Run>> {
	const query = `actions/runs?branch=${encodeURIComponent(branch)}&per_page=${String(RUNS_PER_PAGE)}`
	const runs = runs_page_schema.parse(await read_json(query)).workflow_runs
	const head_sha = runs.at(0)?.head_sha

	return runs.filter((run) => run.head_sha === head_sha)
}

async function run_by_id(run_id: number): Promise<Run> {
	return run_schema.parse(await read_json(`actions/runs/${String(run_id)}`))
}

async function runs_of(target: Target): Promise<Array<Run>> {
	if (target.kind === 'run') return [await run_by_id(target.run_id)]

	const branch = target.kind === 'pr' ? await branch_of_pr(target.pr) : target.branch

	return await latest_runs_of(branch)
}

async function run_timing_of(run: Run): Promise<RunTiming> {
	const page = await read_json(
		`actions/runs/${String(run.id)}/jobs?per_page=${String(JOBS_PER_PAGE)}`,
	)

	return { run, jobs: ci_timing_table.jobs_of(page) }
}

async function timing_of(argument: string): Promise<TimingAnswer> {
	const runs = await runs_of(target_of(argument))

	if (runs.length === 0) return { kind: 'none', target: argument }

	return {
		kind: 'timed',
		runs: await Promise.all(runs.map(async (run) => await run_timing_of(run))),
	}
}

const ci_timing = { target_of, timing_of }

export { ci_timing }
export type { RunTiming, Target, TimingAnswer }
