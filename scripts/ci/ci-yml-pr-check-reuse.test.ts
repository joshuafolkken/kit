import { describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowJob, type WorkflowStep } from './ci-yml-fixture'

const RUNTIME = ci_yml_fixture.RUNTIME_CI_YML
const REUSE_JOB = 'reuse-pr-checks'
const STATIC_JOB = 'static-checks'
const UNIT_JOB = 'unit'
const AGGREGATE_JOB = 'checks'
const PASSED = 'passed=true'
const REUSE_TRUE = "echo 'reuse=true'"

function job(job_name: string): WorkflowJob | undefined {
	return ci_yml_fixture.find_job(RUNTIME, job_name)
}

function job_script(job_name: string): string {
	return (job(job_name)?.steps ?? []).map((step) => ci_yml_fixture.step_run(step)).join('\n')
}

function named_step(job_name: string, step_name: string): WorkflowStep | undefined {
	return job(job_name)?.steps?.find((step) => step.name === step_name)
}

describe('main push PR check reuse proof', () => {
	it('requires one merged PR with an identical tree', () => {
		const script = job_script(REUSE_JOB)

		expect(script).toContain("echo 'reuse=false'")
		expect(script).toContain('.merge_commit_sha == $sha')
		expect(script).toContain('${current_tree}" != "${pr_tree}')
		expect(script).toContain('if ! pull=')
		expect(script.indexOf('reuse=false')).toBeLessThan(script.indexOf('gh api'))
	})

	it('ties the successful Checks job to the selected pull request run', () => {
		const script = job_script(REUSE_JOB)

		expect(script).toContain('.name == "Checks"')
		expect(script).toContain('.conclusion == "success"')
		expect(script).toContain('.event == "pull_request"')
		expect(script).toContain('.head_branch == $head_ref')
		expect(script).toContain('.created_at >= $created_at')
		expect(script).toContain('.created_at <= $merged_at')
		expect(script).toContain('.path == ".github/workflows/ci.yml"')
		expect(script).toContain('pr-checks-${pull_number}')
		expect(script).toContain('if ! run_ids=')
	})

	it('publishes reuse only after every proof passed', () => {
		const script = job_script(REUSE_JOB)

		expect(script).toContain(PASSED)
		expect(script).toContain(REUSE_TRUE)
		expect(script.indexOf(PASSED)).toBeLessThan(script.indexOf(REUSE_TRUE))
		expect(job(REUSE_JOB)?.outputs?.['reuse']).toBe('${{ steps.prove.outputs.reuse }}')
	})
})

describe('main push PR check reuse routing', () => {
	it('grants Actions read access and records the PR number on successful Checks', () => {
		const workflow = ci_yml_fixture.read_workflow(RUNTIME)
		const evidence = named_step(AGGREGATE_JOB, 'Upload PR Checks evidence')

		expect(workflow).toContain('actions: read')
		expect(evidence?.uses).toContain('actions/upload-artifact@')
		expect(evidence?.with?.['name']).toBe('pr-checks-${{ github.event.pull_request.number }}')
	})

	it.each([STATIC_JOB, UNIT_JOB])('skips %s only when the proof output is true', (job_name) => {
		expect(ci_yml_fixture.job_needs(job(job_name))).toContain(REUSE_JOB)
		expect(job(job_name)?.if).toContain("needs.reuse-pr-checks.outputs.reuse != 'true'")
		expect(job(job_name)?.if).toContain('always()')
	})
})
