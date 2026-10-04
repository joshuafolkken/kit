import { describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowStep } from './ci-yml-fixture'
import { workflow_expression_fixture, type ContextTree } from './workflow-expression-fixture'

// sonar-qube.yml is distributed to every consumer, and one that does not use SonarCloud has no
// SONAR_TOKEN — the scan failed on authentication and its required check blocked the consumer's
// first pull request (joshuafolkken/kit#2815). The job now lifts the secret into its env and every
// step branches on it, so a repository without the token skips the scan with a one-line reason while
// one with it (kit itself) scans as before. Each `if:` is evaluated with GitHub's expression engine.
const SONAR_YML = '.github/workflows/sonar-qube.yml'
const SONAR_JOB = 'sonarqube'
const TOKEN_KEY = 'SONAR_TOKEN'
const ENV_CONTEXT = 'env'
const SCAN_STEP_NAME = 'SonarQube Scan'
const SKIP_STEP_NAME = 'Skip SonarQube Scan'
const SCAN_ACTION = 'SonarSource/sonarqube-scan-action'
const CHECKOUT_ACTION = 'actions/checkout'
const SET_TOKEN = 'sqp_example'
const UNSET_TOKEN = ''
// The new-code steps run on a pull request only (joshuafolkken/kit#3045), so the token is exercised on
// the event where every step can run.
const PULL_REQUEST_EVENT = 'pull_request'

function sonar_steps(): ReadonlyArray<WorkflowStep> {
	return ci_yml_fixture.find_job(SONAR_YML, SONAR_JOB)?.steps ?? []
}

function step_runs(step: WorkflowStep, token: string): boolean {
	const context: ContextTree = {
		[ENV_CONTEXT]: { [TOKEN_KEY]: token },
		github: { event_name: PULL_REQUEST_EVENT },
	}

	return step.if === undefined || workflow_expression_fixture.evaluate_condition(step.if, context)
}

function ran_step_names(token: string): ReadonlyArray<string> {
	return sonar_steps()
		.filter((step) => step_runs(step, token))
		.map((step) => step.name ?? step.uses ?? '')
}

describe('sonar-qube.yml job env', () => {
	it('lifts the SONAR_TOKEN secret into the job env the step conditions read', () => {
		const job = ci_yml_fixture.find_job(SONAR_YML, SONAR_JOB)

		expect(job?.env?.[TOKEN_KEY]).toBe('${{ secrets.SONAR_TOKEN }}')
	})
})

describe('sonar-qube.yml with SONAR_TOKEN set', () => {
	it('runs the checkout and the scan and not the skip notice', () => {
		const names = ran_step_names(SET_TOKEN)

		expect(names).toContain(SCAN_STEP_NAME)
		expect(names.some((name) => name.startsWith(CHECKOUT_ACTION))).toBe(true)
		expect(names).not.toContain(SKIP_STEP_NAME)
	})
})

describe('sonar-qube.yml without SONAR_TOKEN', () => {
	it('runs only the skip notice, which prints one line naming the missing token', () => {
		const ran = sonar_steps().filter((step) => step_runs(step, UNSET_TOKEN))

		expect(ran.map((step) => step.name)).toStrictEqual([SKIP_STEP_NAME])
		expect(ran[0]?.run?.trim().split('\n')).toHaveLength(1)
		expect(ran[0]?.run).toContain(TOKEN_KEY)
	})

	it('never reaches the scan action', () => {
		const scans = sonar_steps().filter((step) => step.uses?.startsWith(SCAN_ACTION) === true)

		expect(scans).toHaveLength(1)
		expect(scans.filter((step) => step_runs(step, UNSET_TOKEN))).toHaveLength(0)
	})
})
