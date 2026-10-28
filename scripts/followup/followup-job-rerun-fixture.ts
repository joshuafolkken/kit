import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec, type GhApiRequest } from '#scripts/gh/git-gh-exec'
import { vi } from 'vitest'

// One picture of the GitHub Actions world `followup_job_rerun` reads — the checks rollup, the jobs, the
// runs and a job's log — answered from the mocked `git_gh_command` and `git_gh_exec` of the test that
// imports it. A POST is the rerun itself.

const PR_NUMBER = 4811
const RUN_ID = 40_117_183_013
const UNIT_ID = 103
const ACTIONS = 'repos/{owner}/{repo}/actions/'
const SUCCESS = 'success'
const PASSED_STEPS = [SUCCESS, 'skipped', SUCCESS]
const WORKFLOW_PATH = '.github/workflows/ci.yml'

const fetch_checks = vi.mocked(git_gh_command.pr_get_checks_snapshot)
const api = vi.mocked(git_gh_exec.exec_gh_api)

interface JobInput {
	id: number
	name: string
	conclusion: string
	steps?: Array<string | undefined>
	run_id?: number
	run_attempt?: number
}

interface ActionsWorld {
	jobs: Array<object>
	statuses?: Array<string>
	is_rerun_refused?: boolean
	log?: string
}

function job(input: JobInput): object {
	const { steps = PASSED_STEPS, run_id = RUN_ID, ...rest } = input

	return { ...rest, run_id, steps: steps.map((conclusion) => ({ conclusion })) }
}

function as_check(item: object): object {
	return { ...item, app: { slug: 'github-actions' } }
}

function snapshot_of(rollup: Array<object>): { pr_number: number; snapshot_json: string } {
	return { pr_number: PR_NUMBER, snapshot_json: JSON.stringify({ statusCheckRollup: rollup }) }
}

// The first read finds the failed checks; every later read — the registration wait — sees the
// rerun's queued runs in their place unless told otherwise.
function answer_checks(first: Array<object>, later: Array<object> = []): void {
	fetch_checks.mockResolvedValueOnce(snapshot_of(first)).mockResolvedValue(snapshot_of(later))
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

const followup_job_rerun_fixture = {
	answer_actions,
	answer_checks,
	as_check,
	job,
	rerun_paths,
}

export { ACTIONS, followup_job_rerun_fixture, RUN_ID, SUCCESS, UNIT_ID, WORKFLOW_PATH }
