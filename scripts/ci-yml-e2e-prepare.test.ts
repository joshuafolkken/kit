import { describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowJob } from './ci-yml-fixture'

const E2E_JOB = 'e2e'
const CHECKS_JOB = 'checks'
const PREPARE_RUN = 'pnpm prepare'
const INSTALL_RUN = 'pnpm install --frozen-lockfile --ignore-scripts'
const PLAYWRIGHT_RUN = 'pnpm exec playwright test'
const MISSING = -1

function step_index(job: WorkflowJob | undefined, needle: string): number {
	return job?.steps?.findIndex((step) => step.run?.includes(needle) === true) ?? MISSING
}

describe('ci.yml e2e prepare step (templates/workflows/ci.yml)', () => {
	const workflow = ci_yml_fixture.load_workflow(ci_yml_fixture.TEMPLATE_CI_YML)
	const e2e_job = workflow.jobs[E2E_JOB]

	it('prepares the workspace so generated tsconfig extends targets exist for playwright', () => {
		const prepare_index = step_index(e2e_job, PREPARE_RUN)
		const playwright_index = step_index(e2e_job, PLAYWRIGHT_RUN)

		expect(prepare_index).toBeGreaterThanOrEqual(0)
		expect(playwright_index).toBeGreaterThanOrEqual(0)
		expect(prepare_index).toBeLessThan(playwright_index)
	})

	it('runs prepare only after the dependency install that suppressed it', () => {
		const install_index = step_index(e2e_job, INSTALL_RUN)

		expect(install_index).toBeGreaterThanOrEqual(0)
		expect(install_index).toBeLessThan(step_index(e2e_job, PREPARE_RUN))
	})

	it('keeps the install step on --ignore-scripts', () => {
		const install_step = e2e_job?.steps?.find((step) => step.run?.includes('pnpm install') === true)

		expect(install_step?.run).toContain('--ignore-scripts')
	})

	it('mirrors the preparation the checks job already performs', () => {
		expect(step_index(workflow.jobs[CHECKS_JOB], PREPARE_RUN)).toBeGreaterThanOrEqual(0)
	})
})
