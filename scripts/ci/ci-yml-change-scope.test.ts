import { describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowStep } from './ci-yml-fixture'
import { workflow_expression_fixture } from './workflow-expression-fixture'

const CI = ci_yml_fixture.RUNTIME_CI_YML
const SONAR = '.github/workflows/sonar-qube.yml'
const SCOPE = 'change-scope'
const NOTIFY = 'notify-auto-tag'

function scope_step(workflow: string, index: number): WorkflowStep {
	return ci_yml_fixture.find_job(workflow, SCOPE)?.steps?.[index] ?? {}
}

function sonar_condition(): string {
	return ci_yml_fixture.find_job(SONAR, 'sonarqube')?.if ?? ''
}

function failure_step(): WorkflowStep {
	const job = ci_yml_fixture.find_job(SONAR, 'sonarqube')

	return job?.steps?.find((step) => step.name === 'Require change classification') ?? {}
}

function enabled(job: string, runtime: string): boolean {
	const condition = ci_yml_fixture.find_job(CI, job)?.if ?? ''

	return workflow_expression_fixture.evaluate_condition(
		condition.replace('${{', '').replace('}}', ''),
		{
			needs: {
				'reuse-pr-checks': { outputs: { reuse: 'false' } },
				'change-scope': { outputs: { runtime } },
			},
		},
	)
}

describe('shared change classification wiring', () => {
	it('skips the unit matrix for documentation and runs it for code', () => {
		expect(enabled('unit', 'false')).toBe(false)
		expect(enabled('unit', 'true')).toBe(true)
	})

	it.each([CI, SONAR])('classifies the actual history with the shared action in %s', (workflow) => {
		expect(scope_step(workflow, 0).with?.['fetch-depth']).toBe(0)
		expect(scope_step(workflow, 1).uses).toBe('./.github/actions/change-scope')
	})

	it('does not dispatch auto-tag when the consumer package is unchanged', () => {
		const condition = ci_yml_fixture.find_job(CI, NOTIFY)?.if ?? ''

		expect(condition).toContain("needs.change-scope.outputs.publish == 'true'")
		expect(ci_yml_fixture.job_needs(ci_yml_fixture.find_job(CI, NOTIFY))).toContain(SCOPE)
	})

	it('requires successful classification before Sonar can skip', () => {
		expect(ci_yml_fixture.job_needs(ci_yml_fixture.find_job(SONAR, 'sonarqube'))).toEqual([SCOPE])
		expect(sonar_condition()).toContain("needs.change-scope.result != 'success'")
		expect(sonar_condition()).toContain("needs.change-scope.outputs.runtime != 'false'")
		expect(failure_step().run).toBe('exit 1')
	})
})
