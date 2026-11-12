import { ci_installer_pin } from '#scripts/safe-chain/ci-installer-pin'
import { describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowStep } from './ci-yml-fixture'

// Every workflow installs through the composite action, which carries the pin on its safe-chain
// step (joshuafolkken/kit#2982) — the distributed template included, since the action travels with
// it (joshuafolkken/kit#3095). The action is therefore the one place the pin lives.
const ACTION_YML = ci_yml_fixture.SETUP_PNPM_ACTION
const WORKFLOWS = [ACTION_YML]
const LEGACY_SETUP = 'pnpm dlx @aikidosec/safe-chain'
const SAFE_CHAIN_STEP = 'Setup safe-chain'
// joshuafolkken/kit#6833: the pin sits on its own step so the cache key can read it too.
const PIN_STEP = 'Pin safe-chain'
const SHA256_RE = /^[0-9a-f]{64}$/u
const VERSION_VARIABLE = 'SAFE_CHAIN_INSTALLER_VERSION'
const SHA256_VARIABLE = 'SAFE_CHAIN_INSTALLER_SHA256'
const SHA256_LENGTH = 64
const BINARY_VARIABLE = 'SAFE_CHAIN_BINARY'
const PIN_BINARY = '${{ steps.safe-chain-pin.outputs.binary }}'
const FETCH_STEP = 'Fetch safe-chain'
const TOKEN_VARIABLES = ['GH_TOKEN', 'GITHUB_TOKEN']

function is_action(relative_path: string): boolean {
	return relative_path.endsWith('/action.yml')
}

function all_steps(relative_path: string): ReadonlyArray<WorkflowStep> {
	if (is_action(relative_path)) return ci_yml_fixture.load_action(relative_path).runs.steps

	return Object.values(ci_yml_fixture.load_workflow(relative_path).jobs).flatMap(
		(job) => job.steps ?? [],
	)
}

function safe_chain_steps(relative_path: string): Array<string> {
	return all_steps(relative_path)
		.filter((step) => step.name === SAFE_CHAIN_STEP)
		.map((step) => ci_yml_fixture.step_run(step))
}

function fetch_step(relative_path: string): WorkflowStep | undefined {
	return all_steps(relative_path).find((step) => step.name === FETCH_STEP)
}

// Where the pin is declared: the action's pin step, or the workflow-level env.
function pin_environment(relative_path: string): Record<string, string> {
	if (!is_action(relative_path)) return ci_yml_fixture.load_workflow(relative_path).env ?? {}

	return all_steps(relative_path).find((step) => step.name === PIN_STEP)?.env ?? {}
}

// joshuafolkken/kit#2711: `pnpm dlx … setup-ci` left shims whose `safe-chain` binary was gone by
// the next step, so every CI install ran without a scan behind a warning.
describe.each(WORKFLOWS)('safe-chain setup in %s', (relative_path) => {
	it('checks the installer and the binary against their hashes before setting it up for CI', () => {
		const steps = safe_chain_steps(relative_path)

		expect(steps.length).toBeGreaterThan(0)

		for (const run of steps) {
			expect(run).toContain('echo "$SAFE_CHAIN_INSTALLER_SHA256  $installer" | sha256sum -c -')
			expect(run).toContain('echo "$binary_sha256  $downloads/$SAFE_CHAIN_BINARY" | sha256sum -c -')
			expect(run).toContain('safe-chain" setup-ci')
		}
	})

	it('never sets safe-chain up through pnpm dlx', () => {
		expect(ci_yml_fixture.read_workflow(relative_path)).not.toMatch(
			/pnpm dlx @aikidosec\/safe-chain/u,
		)
	})

	it('pins a release and a full SHA-256', () => {
		const environment = pin_environment(relative_path)

		expect(environment[VERSION_VARIABLE]).toMatch(/^\d+\.\d+\.\d+$/u)
		expect(environment[SHA256_VARIABLE]).toMatch(SHA256_RE)
	})

	it('keeps a pin josh latest can move', () => {
		const pin = { version: '9.9.9', sha256: 'b'.repeat(SHA256_LENGTH) }
		const moved = ci_installer_pin.rewrite_pin(ci_yml_fixture.read_workflow(relative_path), pin)

		expect(moved).toContain(`${VERSION_VARIABLE}: ${pin.version}\n`)
		expect(moved).toContain(`${SHA256_VARIABLE}: ${pin.sha256}\n`)
	})
})

describe.each(WORKFLOWS)('safe-chain download in %s', (relative_path) => {
	// joshuafolkken/kit#6849: anonymous `releases/download` returned 504 through a GitHub outage
	// that authenticated requests passed, turning every job red before its tests.
	it('fetches the release through the authenticated API, never anonymous releases/download', () => {
		const runs = all_steps(relative_path).map((step) => ci_yml_fixture.step_run(step))

		expect(runs.filter((run) => run.includes('releases/download'))).toEqual([])
		expect(fetch_step(relative_path)?.run).toContain(
			`curl --proto '=https' -fsSL "https://api.github.com/repos/AikidoSec/safe-chain/releases/tags/$SAFE_CHAIN_INSTALLER_VERSION"`,
		)
	})

	// The Playwright container some jobs set pnpm up in carries no `gh`.
	it('fetches without the gh CLI', () => {
		expect(fetch_step(relative_path)?.run).not.toMatch(/(?:^|\s)gh\s/mu)
	})

	it('hands the job token to the fetch step alone, never to a step that runs safe-chain', () => {
		const holding = all_steps(relative_path)
			.filter((step) => TOKEN_VARIABLES.some((variable) => step.env?.[variable] !== undefined))
			.map((step) => step.name)

		expect(holding).toEqual([FETCH_STEP])
		expect(fetch_step(relative_path)?.run).not.toMatch(/(?:^|\s)sh\s|safe-chain" |\$installer/mu)
	})

	it('fetches and installs the release the pin step declares', () => {
		const setup = all_steps(relative_path).find((step) => step.name === SAFE_CHAIN_STEP)

		expect(fetch_step(relative_path)?.env).toMatchObject({
			[VERSION_VARIABLE]: '${{ steps.safe-chain-pin.outputs.version }}',
			[BINARY_VARIABLE]: PIN_BINARY,
		})
		expect(setup?.env).toMatchObject({
			[SHA256_VARIABLE]: '${{ steps.safe-chain-pin.outputs.sha256 }}',
			[BINARY_VARIABLE]: PIN_BINARY,
		})
	})
})

// The workflows josh latest moves: every listed one that carries the pin (joshuafolkken/kit#2830).
function pinned_workflow_paths(): Array<string> {
	return ci_installer_pin
		.list_workflows()
		.filter(
			(relative_path) =>
				ci_installer_pin.extract_pinned_version(ci_yml_fixture.read_workflow(relative_path)) !==
				undefined,
		)
}

// joshuafolkken/kit#2765: pr-classification.yml was split out of ci.yml after #2711 and kept the
// old setup, so the guard reads every workflow rather than a list a new one can be left out of.
describe('safe-chain setup across every workflow', () => {
	it('no workflow sets safe-chain up through pnpm dlx', () => {
		const offenders = ci_installer_pin
			.list_workflows()
			.filter((relative_path) => ci_yml_fixture.read_workflow(relative_path).includes(LEGACY_SETUP))

		expect(offenders).toEqual([])
	})

	it('every workflow with a safe-chain step is one josh latest moves', () => {
		const installing = ci_installer_pin
			.list_workflows()
			.filter((relative_path) => safe_chain_steps(relative_path).length > 0)

		expect(new Set(installing)).toEqual(new Set(pinned_workflow_paths()))
	})
})

describe('safe-chain installer pin parity', () => {
	it('every pinned workflow installs the same release with the same SHA-256', () => {
		const pins = WORKFLOWS.map((relative_path) => {
			const environment = pin_environment(relative_path)

			return JSON.stringify([environment[VERSION_VARIABLE], environment[SHA256_VARIABLE]])
		})

		expect(new Set(pins).size).toBe(1)
	})

	it('the pinned workflows are the ones josh latest moves', () => {
		expect(new Set(pinned_workflow_paths())).toEqual(new Set(WORKFLOWS))
	})
})

// joshuafolkken/kit#3095: the template carried the installer step inline in each job and its own
// copy of the pin, a second path kit's CI never ran.
describe('safe-chain setup in the distributed template', () => {
	it('carries no installer step and no pin of its own', () => {
		const template = ci_yml_fixture.TEMPLATE_CI_YML

		expect(safe_chain_steps(template)).toEqual([])
		expect(
			ci_installer_pin.extract_pinned_version(ci_yml_fixture.read_workflow(template)),
		).toBeUndefined()
	})
})
