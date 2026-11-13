import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec, type GhApiRequest } from '#scripts/gh/git-gh-exec'
import { import_graph, type ImportGraph } from '#scripts/lint/import-graph'
import { vi } from 'vitest'
import { followup_job_needs } from './followup-job-needs'

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
const INDIRECT_TEST = 'scripts/sync/sync-directory-guards.test.ts'
const INDIRECT_CHANGE = 'scripts/run/startup/run-startup-store.ts'
// Reduced from #7422's dispatch line 932 and ship lines 483–510: the direct subject was unchanged.
const IMPORT_DIAGNOSTIC =
	'Error: [vitest] No "constants" export is defined on the "node:fs" mock. Did you forget to return it from "vi.mock"?'
const IMPORT_LOG = [
	` FAIL  |isolated| ${INDIRECT_TEST} [ ${INDIRECT_TEST} ]`,
	IMPORT_DIAGNOSTIC,
	' ❯ scripts/lane/lane-ledger-write.ts:71:53',
	` ❯ ${INDIRECT_CHANGE}:2:1`,
	' Test Files  1 failed (1)',
	'      Tests  no tests',
]
	.map((line) => `2026-11-13T06:20:16.000Z ${line}`)
	.join('\n')

const fetch_checks = vi.mocked(git_gh_command.pr_get_checks_snapshot)
const api = vi.mocked(git_gh_exec.exec_gh_api)

// A closed test with no runtime input besides itself; individual tests replace this proof.
function answer_closed_inputs(): void {
	const graph: ImportGraph = {
		test_inputs: (file) => [file],
		closure: () => [],
		closure_hash: () => '',
		imports: () => [],
		importers: () => new Set(),
		runtime_importers: () => new Set(),
		strings: () => [],
	}

	vi.spyOn(import_graph, 'create').mockResolvedValue(graph)
}

function answer_unit_needs(): void {
	vi.mocked(followup_job_needs.read_graph).mockResolvedValue(
		followup_job_needs.parse_graph(
			'jobs:\n  unit:\n    name: Unit Tests\n  checks:\n    name: Checks\n    needs: unit\n',
		),
	)
}

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

function failed_checks(id: number): object {
	return job({ id, name: 'Checks', conclusion: 'failure', steps: ['success', 'failure'] })
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
	answer_closed_inputs,
	answer_unit_needs,
	failed_checks,
	as_check,
	job,
	rerun_paths,
}

export {
	ACTIONS,
	followup_job_rerun_fixture,
	RUN_ID,
	SUCCESS,
	UNIT_ID,
	WORKFLOW_PATH,
	INDIRECT_TEST,
	INDIRECT_CHANGE,
	IMPORT_DIAGNOSTIC,
	IMPORT_LOG,
}
