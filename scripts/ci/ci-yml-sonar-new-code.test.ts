import { describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowStep } from './ci-yml-fixture'
import { workflow_expression_fixture, type ContextTree } from './workflow-expression-fixture'

// joshuafolkken/kit#3045: the Quality Gate alone let a pull request add code smells and a copied block
// and stay green, and an analysis without `sonar.projectVersion` never moved the New Code start. The
// scan now carries the package version, and a pull request run ends with `josh sonar:new-code`, which
// fails on a single new issue or duplicated block. Each `if:` is evaluated with GitHub's engine.
const SONAR_YML = '.github/workflows/sonar-qube.yml'
const SONAR_JOB = 'sonarqube'
const CHECK_STEP_NAME = 'Fail on new Sonar issues or duplicated blocks'
const VERSION_STEP_ID = 'project-version'
const SCAN_STEP_NAME = 'SonarQube Scan'
const SET_TOKEN = 'sqp_example'
const PULL_REQUEST_EVENT = 'pull_request'
const PUSH_EVENT = 'push'

function sonar_steps(): ReadonlyArray<WorkflowStep> {
	return ci_yml_fixture.find_job(SONAR_YML, SONAR_JOB)?.steps ?? []
}

function step_named(name: string): WorkflowStep | undefined {
	return sonar_steps().find((step) => step.name === name)
}

function ran_step_names(token: string, event_name: string): ReadonlyArray<string> {
	const context: ContextTree = { env: { SONAR_TOKEN: token }, github: { event_name } }

	return sonar_steps()
		.filter(
			(step) =>
				step.if === undefined || workflow_expression_fixture.evaluate_condition(step.if, context),
		)
		.map((step) => step.name ?? step.uses ?? '')
}

describe('sonar-qube.yml new-code check', () => {
	it('runs on a pull request after the scan', () => {
		const names = ran_step_names(SET_TOKEN, PULL_REQUEST_EVENT)

		expect(names).toContain(CHECK_STEP_NAME)
		expect(names.indexOf(CHECK_STEP_NAME)).toBeGreaterThan(names.indexOf(SCAN_STEP_NAME))
	})

	it('runs josh sonar:new-code on the pull request number', () => {
		const step = step_named(CHECK_STEP_NAME)

		expect(step?.run).toContain('pnpm josh sonar:new-code')
		expect(step?.env?.['PULL_REQUEST']).toBe('${{ github.event.pull_request.number }}')
	})

	it('does not run on a push to main, which has no pull request', () => {
		expect(ran_step_names(SET_TOKEN, PUSH_EVENT)).not.toContain(CHECK_STEP_NAME)
	})

	it('does not run without SONAR_TOKEN', () => {
		expect(ran_step_names('', PULL_REQUEST_EVENT)).not.toContain(CHECK_STEP_NAME)
	})
})

describe('sonar-qube.yml project version', () => {
	it('passes the version step output to the scan', () => {
		expect(step_named(SCAN_STEP_NAME)?.with?.['args']).toContain(
			`steps.${VERSION_STEP_ID}.outputs.args`,
		)
	})

	it('reads the version from package.json as sonar.projectVersion', () => {
		const step = sonar_steps().find((entry) => entry.id === VERSION_STEP_ID)

		expect(step?.run).toContain('package.json')
		expect(step?.run).toContain('-Dsonar.projectVersion=')
	})

	it('resolves the version on a push to main as well as on a pull request', () => {
		const step = sonar_steps().find((entry) => entry.id === VERSION_STEP_ID)

		expect(step?.if).not.toContain('github.event_name')
	})
})
