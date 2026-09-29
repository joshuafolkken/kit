import { ci_installer_pin } from '#scripts/safe-chain/ci-installer-pin'
import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

const WORKFLOWS = [ci_yml_fixture.RUNTIME_CI_YML, ci_yml_fixture.TEMPLATE_CI_YML]
const SHA256_RE = /^[0-9a-f]{64}$/u
const VERSION_VARIABLE = 'SAFE_CHAIN_INSTALLER_VERSION'
const SHA256_VARIABLE = 'SAFE_CHAIN_INSTALLER_SHA256'

function safe_chain_steps(relative_path: string): Array<string> {
	const workflow = ci_yml_fixture.load_workflow(relative_path)

	return Object.values(workflow.jobs)
		.flatMap((job) => job.steps ?? [])
		.filter((step) => step.name === 'Setup safe-chain')
		.map((step) => ci_yml_fixture.step_run(step))
}

// joshuafolkken/kit#2711: `pnpm dlx … setup-ci` left shims whose `safe-chain` binary was gone by
// the next step, so every CI install ran without a scan behind a warning.
describe.each(WORKFLOWS)('safe-chain setup in %s', (relative_path) => {
	it('installs the binary through the hash-verified release installer in CI mode', () => {
		const steps = safe_chain_steps(relative_path)

		expect(steps.length).toBeGreaterThan(0)

		for (const run of steps) {
			expect(run).toContain('releases/download/$SAFE_CHAIN_INSTALLER_VERSION/install-safe-chain.sh')
			expect(run).toContain('sha256sum -c -')
			expect(run).toContain('--ci')
		}
	})

	it('never sets safe-chain up through pnpm dlx', () => {
		expect(ci_yml_fixture.read_workflow(relative_path)).not.toContain('safe-chain setup-ci')
		expect(ci_yml_fixture.read_workflow(relative_path)).not.toMatch(
			/pnpm dlx @aikidosec\/safe-chain/u,
		)
	})

	it('pins a release and a full SHA-256 at workflow level', () => {
		const environment = ci_yml_fixture.load_workflow(relative_path).env ?? {}

		expect(environment[VERSION_VARIABLE]).toMatch(/^\d+\.\d+\.\d+$/u)
		expect(environment[SHA256_VARIABLE]).toMatch(SHA256_RE)
	})
})

describe('safe-chain installer pin parity', () => {
	it('the template and the runtime workflow install the same release', () => {
		const [runtime, template] = WORKFLOWS.map((relative_path) =>
			ci_installer_pin.extract_pinned_version(ci_yml_fixture.read_workflow(relative_path)),
		)

		expect(template).toBe(runtime)
	})

	it('the pinned workflows are the ones josh latest moves', () => {
		expect(ci_installer_pin.WORKFLOW_PATHS).toEqual(WORKFLOWS)
	})
})
