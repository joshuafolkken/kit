import { readdirSync } from 'node:fs'
import { package_path } from '#scripts/init/init-paths'
import { ci_installer_pin } from '#scripts/safe-chain/ci-installer-pin'
import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

const PR_CLASSIFICATION_YML = '.github/workflows/pr-classification.yml'
const WORKFLOWS = [
	ci_yml_fixture.RUNTIME_CI_YML,
	ci_yml_fixture.TEMPLATE_CI_YML,
	PR_CLASSIFICATION_YML,
]
const LEGACY_SETUP = 'pnpm dlx @aikidosec/safe-chain'
// Every workflow kit runs or distributes — kit's own set and the templates `josh sync` renders.
const WORKFLOW_DIRECTORIES = ['.github/workflows', 'templates/workflows']
const WORKFLOW_FILE_RE = /\.ya?ml$/u
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

	it('refuses to follow the release redirect onto anything but HTTPS', () => {
		for (const run of safe_chain_steps(relative_path)) {
			expect(run).toContain("curl --proto '=https' -fsSL")
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

function all_workflow_paths(): Array<string> {
	return WORKFLOW_DIRECTORIES.flatMap((directory) =>
		readdirSync(package_path(directory))
			.filter((file_name) => WORKFLOW_FILE_RE.test(file_name))
			.map((file_name) => `${directory}/${file_name}`),
	)
}

// joshuafolkken/kit#2765: pr-classification.yml was split out of ci.yml after #2711 and kept the
// old setup, so the guard reads every workflow rather than a list a new one can be left out of.
describe('safe-chain setup across every workflow', () => {
	it('no workflow sets safe-chain up through pnpm dlx', () => {
		const offenders = all_workflow_paths().filter((relative_path) =>
			ci_yml_fixture.read_workflow(relative_path).includes(LEGACY_SETUP),
		)

		expect(offenders).toEqual([])
	})

	it('every workflow with a safe-chain step is one josh latest moves', () => {
		const installing = all_workflow_paths().filter(
			(relative_path) => safe_chain_steps(relative_path).length > 0,
		)

		expect(new Set(installing)).toEqual(new Set(ci_installer_pin.WORKFLOW_PATHS))
	})
})

describe('safe-chain installer pin parity', () => {
	it('every pinned workflow installs the same release with the same SHA-256', () => {
		const pins = WORKFLOWS.map((relative_path) => {
			const environment = ci_yml_fixture.load_workflow(relative_path).env ?? {}

			return JSON.stringify([environment[VERSION_VARIABLE], environment[SHA256_VARIABLE]])
		})

		expect(new Set(pins).size).toBe(1)
	})

	it('the pinned workflows are the ones josh latest moves', () => {
		expect(ci_installer_pin.WORKFLOW_PATHS).toEqual(WORKFLOWS)
	})
})
