import { describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowJob, type WorkflowStep } from './ci-yml-fixture'

// Both files carry the same resolution block: templates/ is the artifact josh sync
// distributes to consumers, .github/ is kit's own runtime copy. Asserting on both
// keeps them from drifting apart.
const WORKFLOW_PATHS = [ci_yml_fixture.TEMPLATE_CI_YML, ci_yml_fixture.RUNTIME_CI_YML] as const

const RESOLVE_JOB = 'playwright-image'
const CHECKS_JOB = 'checks'
const E2E_JOB = 'e2e'
const RESOLVE_STEP_ID = 'resolve'
const CONTAINER_EXPRESSION = '${{ fromJSON(needs.playwright-image.outputs.container) }}'
const INSTALL_GUARD = "needs.playwright-image.outputs.should_install_browsers == 'true'"
const BROWSER_INSTALL_RUN = './node_modules/.bin/playwright install --with-deps'
const UNIT_TEST_RUN = 'pnpm josh test:unit'
const MANIFEST_PROBE_URL = 'https://mcr.microsoft.com/v2/playwright/manifests/'
const VERSION_SANITIZER = "tr -cd 'A-Za-z0-9.-'"
const NO_CONTAINER_OUTPUT = 'container=null'
const FALLBACK_WARNING = '::warning::Playwright image'

function find_step(
	job: WorkflowJob | undefined,
	should_match: (step: WorkflowStep) => boolean,
): WorkflowStep | undefined {
	return job?.steps?.find((step) => should_match(step))
}

describe.each(WORKFLOW_PATHS)('%s — Playwright image resolution', (relative_path) => {
	const resolve_job = ci_yml_fixture.find_job(relative_path, RESOLVE_JOB)
	const resolve_run = find_step(resolve_job, (step) => step.id === RESOLVE_STEP_ID)?.run ?? ''

	it('exposes a container object and an install flag instead of a bare image tag', () => {
		expect(resolve_job?.outputs).toMatchObject({
			container: '${{ steps.resolve.outputs.container }}',
			should_install_browsers: '${{ steps.resolve.outputs.should_install_browsers }}',
		})
		expect(resolve_job?.outputs).not.toHaveProperty('image')
	})

	it('skips the container and the browser download when Playwright is not a dependency', () => {
		expect(resolve_run).toContain('if [ -z "${version}" ]')
		expect(resolve_run).toContain(NO_CONTAINER_OUTPUT)
		expect(resolve_run).toContain('should_install_browsers=false')
	})

	it('whitelists the version characters before writing it into $GITHUB_OUTPUT as JSON', () => {
		expect(resolve_run).toContain(VERSION_SANITIZER)
	})

	it('probes the MCR manifest before committing to a container image', () => {
		expect(resolve_run).toContain(MANIFEST_PROBE_URL)
		expect(resolve_run).toContain('if [ "${status}" = \'200\' ]')
	})

	it('falls back to no container and self-installed browsers when the probe fails', () => {
		expect(resolve_run).toContain(NO_CONTAINER_OUTPUT)
		expect(resolve_run).toContain('should_install_browsers=true')
	})

	it('surfaces the fallback as a CI warning so the substitution is never silent', () => {
		expect(resolve_run).toContain(FALLBACK_WARNING)
	})
})

describe.each(WORKFLOW_PATHS)('%s — e2e job container fallback', (relative_path) => {
	const e2e_job = ci_yml_fixture.find_job(relative_path, E2E_JOB)

	it('resolves the e2e container through fromJSON so null means a plain runner', () => {
		expect(e2e_job?.container).toBe(CONTAINER_EXPRESSION)
	})

	it('installs browsers only when the resolve job says the image was unavailable', () => {
		const install_step = find_step(e2e_job, (step) => step.run === BROWSER_INSTALL_RUN)

		expect(install_step).toBeDefined()
		expect(install_step?.if).toBe(INSTALL_GUARD)
	})
})

// Only the distributed template containerizes `checks`; kit's own runtime workflow runs
// it on a plain runner and has no browser-mode unit tests.
describe('templates/workflows/ci.yml — containerized checks job', () => {
	const checks_job = ci_yml_fixture.find_job(ci_yml_fixture.TEMPLATE_CI_YML, CHECKS_JOB)

	it('resolves the checks container through the same fromJSON fallback', () => {
		expect(checks_job?.container).toBe(CONTAINER_EXPRESSION)
	})

	it('installs browsers before the unit tests so browser-mode projects still run', () => {
		const step_names = checks_job?.steps?.map((step) => step.run) ?? []
		const install_index = step_names.indexOf(BROWSER_INSTALL_RUN)
		const unit_index = step_names.indexOf(UNIT_TEST_RUN)
		const install_step = find_step(checks_job, (step) => step.run === BROWSER_INSTALL_RUN)

		expect(install_step?.if).toBe(INSTALL_GUARD)
		expect(install_index).toBeGreaterThanOrEqual(0)
		expect(install_index).toBeLessThan(unit_index)
	})
})
