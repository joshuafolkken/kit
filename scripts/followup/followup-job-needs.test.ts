import { describe, expect, it } from 'vitest'
import { followup_job_needs, type RunJob } from './followup-job-needs'

const GATE = 'Require the gate'
const GUARD = 'Require change classification'
const SCOPE = 'Change scope'
const SONAR = 'SonarQube'
const SUCCESS = 'success'
const FAILURE = 'failure'

const WORKFLOW = [
	'jobs:',
	'  unit:',
	'    name: Unit Tests (${{ matrix.shard }}/6)',
	'  static-checks:',
	'    name: Static Checks',
	'  build:',
	'    name: Build',
	'  checks:',
	'    name: Checks',
	'    needs: [static-checks, unit]',
	'    steps:',
	`      - name: ${GATE}`,
	'        env:',
	'          UNIT_RESULT: ${{ needs.unit.result }}',
	'  change-scope:',
	`    name: ${SCOPE}`,
	'  sonarqube:',
	`    name: ${SONAR}`,
	'    needs: change-scope',
	'    steps:',
	`      - name: ${GUARD}`,
	"        if: needs.change-scope.result != 'success'",
	'      - name: Install',
	"        if: needs.change-scope.outputs.runtime == 'true'",
	'      - name: Scan',
	'  deploy:',
	'    needs: build',
	'  release:',
	'    name: Release',
	'    uses: ./.github/workflows/release.yml',
	'  publish:',
	'    needs: release',
].join('\n')

const SHARD = 'Unit Tests (5/6)'
const STATIC_CHECKS = 'Static Checks'
const NEEDS_NOTHING = 'the job needs nothing'

describe('followup_job_needs.is_waiting_on', () => {
	const graph = followup_job_needs.parse_graph(WORKFLOW)

	it('is true for a job that needs the matrix job a templated name matches', () => {
		expect(followup_job_needs.is_waiting_on(graph, 'Checks', [SHARD])).toBe(true)
	})

	it('is true for a job that needs a plain-named job carrying a matrix suffix', () => {
		expect(followup_job_needs.is_waiting_on(graph, 'deploy', ['Build (20)'])).toBe(true)
	})

	it.each([
		['a job that needs nothing', STATIC_CHECKS],
		['a job no workflow job is named', 'Lint'],
	])('is false for %s', (_label, job_name) => {
		expect(followup_job_needs.is_waiting_on(graph, job_name, [SHARD])).toBe(false)
	})
})

describe('followup_job_needs.is_missing_need', () => {
	const graph = followup_job_needs.parse_graph(WORKFLOW)

	it('is true for a job whose needed job the run never created', () => {
		expect(followup_job_needs.is_missing_need(graph, 'Checks', [STATIC_CHECKS])).toBe(true)
	})

	it.each([
		['every needed job is in the run', 'Checks', [STATIC_CHECKS, SHARD]],
		['the needed reusable workflow ran its called job', 'publish', ['Release / pack']],
		[NEEDS_NOTHING, STATIC_CHECKS, []],
		['no workflow job is named so', 'Lint', []],
	])('is false when %s', (_label, job_name, run_jobs) => {
		expect(followup_job_needs.is_missing_need(graph, job_name, run_jobs)).toBe(false)
	})
})

function run_job(name: string, conclusion: string, failed_step?: string): RunJob {
	return { name, conclusion, steps: [{ name: failed_step, conclusion: FAILURE }] }
}

// joshuafolkken/kit#6924: a gate handed `abandoned` for needs that had succeeded.
describe('followup_job_needs.is_gate_of_successes', () => {
	const graph = followup_job_needs.parse_graph(WORKFLOW)
	const scope = run_job(SCOPE, SUCCESS)
	const sonar = run_job(SONAR, FAILURE, GUARD)

	it.each([
		['its `if` reads the needs', sonar, [scope]],
		['its `if` reads the needs, one skipped', sonar, [run_job(SCOPE, 'skipped')]],
		['its `if` reads the needs, one the run never listed', sonar, []],
		[
			'its `env` reads the needs',
			run_job('Checks', FAILURE, GATE),
			[run_job(STATIC_CHECKS, SUCCESS), run_job(SHARD, SUCCESS)],
		],
	])('is true for a gate failed in a step whose %s', (_label, job, run_jobs) => {
		expect(followup_job_needs.is_gate_of_successes(graph, job, run_jobs)).toBe(true)
	})

	it.each([
		['a needed job failed', sonar, [run_job(SCOPE, FAILURE)]],
		['it failed in a step not reading the needs', run_job(SONAR, FAILURE, 'Scan'), [scope]],
		['it failed in a step reading a needs output', run_job(SONAR, FAILURE, 'Install'), [scope]],
		[NEEDS_NOTHING, run_job(SCOPE, FAILURE, GUARD), [scope]],
	])('is false for a gate when %s', (_label, job, run_jobs) => {
		expect(followup_job_needs.is_gate_of_successes(graph, job, run_jobs)).toBe(false)
	})
})

describe('followup_job_needs.parse_graph', () => {
	it('reads no job from a workflow whose jobs are not a mapping', () => {
		expect(followup_job_needs.parse_graph('name: CI\njobs: [unit]')).toStrictEqual([])
	})
})

describe('followup_job_needs.read_graph', () => {
	it('reads no job from a workflow file that is missing', async () => {
		await expect(
			followup_job_needs.read_graph('.github/workflows/missing.yml'),
		).resolves.toStrictEqual([])
	})
})
