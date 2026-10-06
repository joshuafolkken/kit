import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { package_path } from '#scripts/init/init-paths'
import semver from 'semver'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ci_yml_fixture, type WorkflowStep } from './ci-yml-fixture'

const ACTION = 'pnpm/setup@fbda4c85fc2e1e08721cd8763afea8f48d60f024'
const VERSION_INPUT = '${{ steps.pnpm-version.outputs.version }}'
const RESOLVER_ID = 'pnpm-version'
const E2E_JOB = 'e2e'
const STATIC_CHECKS_JOB = 'static-checks'
const NODE_COMPAT_JOB = 'node-compat'
const NEWEST_NODE_MAJOR = 26
const ENGINES_SCHEMA = z.looseObject({ engines: z.looseObject({ node: z.string() }) })
const UTF8 = 'utf8'
const PACKAGE_JSON = 'package.json'
const NODE_COMPAT_RUNTIME = 'node@${{ matrix.node }}'
const NODE_VERSION_STEP = 'Verify Node.js version'
const PUBLISH_YML = '.github/workflows/publish.yml'
const RUNTIME_WORKFLOWS_DIR = '.github/workflows'
const PUBLISH_JOBS = ['publish-github', 'publish-npm', 'create-release']
const INSTALL_COMMAND = 'pnpm install --frozen-lockfile --ignore-scripts'
const SAFE_CHAIN_STEP = 'Setup safe-chain'
const WHEN_INSTALLING = "inputs.install == 'true'"
const ACTION_STEPS = ci_yml_fixture.load_action(ci_yml_fixture.SETUP_PNPM_ACTION).runs.steps
// The jobs that prepare pnpm, all through the composite action: kit's own workflows, and the
// distributed template, which calls the action `josh sync` writes beside it (joshuafolkken/kit#3095).
const ACTION_CALLERS = [
	{
		path: ci_yml_fixture.RUNTIME_CI_YML,
		jobs: [STATIC_CHECKS_JOB, 'unit', E2E_JOB, NODE_COMPAT_JOB],
	},
	{ path: PUBLISH_YML, jobs: PUBLISH_JOBS },
	{ path: '.github/workflows/pr-classification.yml', jobs: ['classification'] },
	{ path: ci_yml_fixture.TEMPLATE_CI_YML, jobs: ['checks', E2E_JOB] },
]
type Steps = ReadonlyArray<WorkflowStep>

function engines_node_floor(): string | undefined {
	const raw = readFileSync(package_path(PACKAGE_JSON), UTF8)
	const manifest = ENGINES_SCHEMA.parse(JSON.parse(raw))

	return semver.minVersion(manifest.engines.node)?.version
}

function required_steps(workflow_path: string, job_name: string): Steps {
	const steps = ci_yml_fixture.find_job(workflow_path, job_name)?.steps
	if (steps === undefined) throw new Error(`Missing steps in ${workflow_path}:${job_name}`)

	return steps
}

function action_call(workflow_path: string, job_name: string): WorkflowStep | undefined {
	return required_steps(workflow_path, job_name).find(
		(step) => step.uses === ci_yml_fixture.SETUP_PNPM_USES,
	)
}

function run_resolver(steps: Steps, manifest: unknown): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'kit-pnpm-version-'))
	const output_path = path.join(directory, 'github-output')
	const script = steps.find((step) => step.id === RESOLVER_ID)?.run ?? ''

	try {
		writeFileSync(path.join(directory, PACKAGE_JSON), JSON.stringify(manifest))
		const result = spawnSync('bash', ['-e', '-c', script], {
			cwd: directory,
			encoding: 'utf8',
			env: { ...process.env, GITHUB_OUTPUT: output_path },
		})

		expect(result.status, result.stderr).toBe(0)

		return readFileSync(output_path, 'utf8')
	} finally {
		rmSync(directory, { recursive: true, force: true })
	}
}

function expect_pnpm_before_use(steps: Steps): void {
	const setup_index = steps.findIndex((step) => step.uses === ACTION)
	const resolve_index = steps.findIndex((step) => step.id === RESOLVER_ID)
	const first_use = steps.findIndex((step) => step.run?.includes('pnpm '))

	expect(steps[setup_index]).toMatchObject({
		uses: ACTION,
		with: { install: false, version: VERSION_INPUT },
	})
	expect(steps[resolve_index]?.run).toContain('m.packageManager?.match(/^pnpm@([^+]+)/)')
	expect(resolve_index).toBeGreaterThanOrEqual(0)
	expect(setup_index).toBeGreaterThan(resolve_index)
	expect(first_use).toBeGreaterThan(setup_index)
}

function action_step(name: string): WorkflowStep | undefined {
	return ACTION_STEPS.find((step) => step.name === name)
}

describe('the setup-pnpm composite action', () => {
	it('resolves the version, sets pnpm up, then installs behind safe-chain', () => {
		const safe_chain = ACTION_STEPS.findIndex((step) => step.name === SAFE_CHAIN_STEP)
		const install = ACTION_STEPS.findIndex((step) => step.run === INSTALL_COMMAND)

		expect_pnpm_before_use(ACTION_STEPS)
		expect(safe_chain).toBeGreaterThan(ACTION_STEPS.findIndex((step) => step.uses === ACTION))
		expect(install).toBeGreaterThan(safe_chain)
	})

	it('scans whenever it installs, and skips both only together', () => {
		expect(action_step(SAFE_CHAIN_STEP)?.if).toBe(WHEN_INSTALLING)
		expect(action_step('Install dependencies')?.if).toBe(WHEN_INSTALLING)
	})

	it('restores the pnpm store only when asked to', () => {
		const store_steps = ACTION_STEPS.filter((step) => step.name?.includes('store'))

		expect(store_steps).toHaveLength(2)

		for (const step of store_steps) {
			expect(step.if).toBe(`${WHEN_INSTALLING} && inputs.cache == 'true'`)
		}
	})
})

it.each([ci_yml_fixture.SETUP_PNPM_ACTION, ci_yml_fixture.TEMPLATE_CI_YML])(
	'does not invoke Corepack in %s',
	(relative_path) => {
		expect(ci_yml_fixture.read_workflow(relative_path)).not.toContain('corepack enable')
	},
)

describe.each(ACTION_CALLERS)('pnpm setup in $path', ({ path: workflow_path, jobs }) => {
	it.each(jobs)('prepares pnpm through the composite action before use in %s', (job_name) => {
		const steps = required_steps(workflow_path, job_name)
		const call_index = steps.findIndex((step) => step.uses === ci_yml_fixture.SETUP_PNPM_USES)
		const first_use = steps.findIndex((step) => step.run?.includes('pnpm '))

		expect(call_index).toBeGreaterThanOrEqual(0)
		expect(first_use).toBeGreaterThan(call_index)
		expect(steps.some((step) => step.id === RESOLVER_ID || step.uses === ACTION)).toBe(false)
	})
})

describe('the publish workflow', () => {
	it.each(PUBLISH_JOBS)('installs behind safe-chain without the store cache in %s', (job_name) => {
		expect(action_call(PUBLISH_YML, job_name)?.with).toEqual({ cache: 'false' })
	})
})

// joshuafolkken/kit#2982: publish.yml installed without the scan while ci.yml had it, so the guard
// reads every workflow rather than a list a new one can be left out of.
describe('pnpm setup across every kit workflow', () => {
	it('no workflow installs or sets pnpm up outside the composite action', () => {
		const offenders = readdirSync(package_path(RUNTIME_WORKFLOWS_DIR))
			.map((file_name) => `${RUNTIME_WORKFLOWS_DIR}/${file_name}`)
			.filter((relative_path) => {
				const content = ci_yml_fixture.read_workflow(relative_path)

				return content.includes('pnpm install') || content.includes(`uses: ${ACTION}`)
			})

		expect(offenders).toEqual([])
	})
})

describe.each([
	{ pin: 'pnpm@12.6.0+sha512.abc123', version: '12.6.0' },
	{ pin: 'pnpm@12.7.0+sha512.def456', version: '12.7.0' },
])('pnpm version extraction from $pin', ({ pin, version }) => {
	it('uses packageManager and strips the integrity suffix', () => {
		const manifest = {
			packageManager: pin,
			devEngines: { packageManager: { name: 'pnpm', version: pin.split('@', 2)[1] } },
		}

		expect(run_resolver(ACTION_STEPS, manifest)).toBe(`version=${version}\n`)
	})
})

it('uses devEngines when packageManager is absent', () => {
	const manifest = {
		devEngines: { packageManager: { name: 'pnpm', version: '11.4.0+sha512.abc' } },
	}

	expect(run_resolver(ACTION_STEPS, manifest)).toBe('version=11.4.0\n')
})

it('uses the latest pnpm when no version is declared', () => {
	expect(run_resolver(ACTION_STEPS, { name: 'consumer' })).toBe('version=latest\n')
})

describe('Node compatibility job', () => {
	it('runs on the exact engines floor and the newest supported Node', () => {
		const strategy = ci_yml_fixture.find_job(
			ci_yml_fixture.RUNTIME_CI_YML,
			NODE_COMPAT_JOB,
		)?.strategy

		expect(strategy).toMatchObject({
			'fail-fast': false,
			matrix: { node: [engines_node_floor(), NEWEST_NODE_MAJOR] },
		})
	})

	it('installs on the matrix runtime through the composite action', () => {
		const setup = ACTION_STEPS.find((step) => step.uses === ACTION)

		expect(action_call(ci_yml_fixture.RUNTIME_CI_YML, NODE_COMPAT_JOB)?.with).toEqual({
			runtime: NODE_COMPAT_RUNTIME,
		})
		expect(setup?.with?.['runtime']).toBe('${{ inputs.runtime }}')
	})

	it('checks the runtime, builds, then starts the bundled CLI', () => {
		const steps = required_steps(ci_yml_fixture.RUNTIME_CI_YML, NODE_COMPAT_JOB)
		const runs = steps.map((step) => step.run).filter((run) => run !== undefined)

		expect(runs.slice(1)).toEqual(['pnpm build', 'node dist/josh.js help'])
		const version_step = steps.find((step) => step.name === NODE_VERSION_STEP)

		expect(version_step?.env).toEqual({ NODE_VERSION: '${{ matrix.node }}' })
		expect(version_step?.run).toContain('tee /dev/stderr | grep -qE "^v${NODE_VERSION}(\\.|$)"')
	})
})

describe('pnpm update documentation', () => {
	it('describes self-update without a Corepack installation instruction', () => {
		const commands = readFileSync(package_path('docs/josh-commands.md'), 'utf8')
		const troubleshooting = readFileSync(package_path('docs/troubleshooting.md'), 'utf8')

		expect(commands).toContain('pnpm self-update')
		expect(troubleshooting).not.toContain('corepack prepare')
	})
})
