import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { package_path } from '#scripts/init/init-paths'
import { describe, expect, it } from 'vitest'
import { ci_yml_fixture } from './ci-yml-fixture'

const ACTION = 'pnpm/setup@fbda4c85fc2e1e08721cd8763afea8f48d60f024'
const VERSION_INPUT = '${{ steps.pnpm-version.outputs.version }}'
const RESOLVER_ID = 'pnpm-version'
const E2E_JOB = 'e2e'
const STATIC_CHECKS_JOB = 'static-checks'
const NODE_26_JOB = 'node-26-pnpm'
const CASES = [
	{
		path: ci_yml_fixture.RUNTIME_CI_YML,
		jobs: [STATIC_CHECKS_JOB, 'unit', E2E_JOB, NODE_26_JOB],
	},
	{ path: ci_yml_fixture.TEMPLATE_CI_YML, jobs: ['checks', E2E_JOB] },
	{ path: '.github/workflows/publish.yml', jobs: ['publish'] },
]
type Steps = NonNullable<NonNullable<ReturnType<typeof ci_yml_fixture.find_job>>['steps']>

function required_steps(workflow_path: string, job_name: string): Steps {
	const steps = ci_yml_fixture.find_job(workflow_path, job_name)?.steps
	if (steps === undefined) throw new Error(`Missing steps in ${workflow_path}:${job_name}`)

	return steps
}

function run_resolver(workflow_path: string, job_name: string, manifest: unknown): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'kit-pnpm-version-'))
	const output_path = path.join(directory, 'github-output')
	const script =
		required_steps(workflow_path, job_name).find((step) => step.id === RESOLVER_ID)?.run ?? ''

	try {
		writeFileSync(path.join(directory, 'package.json'), JSON.stringify(manifest))
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

describe.each(CASES)('pnpm setup in $path', ({ path: workflow_path, jobs }) => {
	it.each(jobs)('installs pnpm before use in %s', (job_name) => {
		const steps = required_steps(workflow_path, job_name)
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
	})

	it('uses the same version extraction in every pnpm job', () => {
		const runs = jobs.map(
			(job_name) =>
				required_steps(workflow_path, job_name).find((step) => step.id === RESOLVER_ID)?.run,
		)

		expect(new Set(runs).size).toBe(1)
	})

	it('does not invoke Corepack', () => {
		expect(ci_yml_fixture.read_workflow(workflow_path)).not.toContain('corepack enable')
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

		expect(run_resolver(ci_yml_fixture.RUNTIME_CI_YML, STATIC_CHECKS_JOB, manifest)).toBe(
			`version=${version}\n`,
		)
	})
})

it.each([
	{ path: ci_yml_fixture.RUNTIME_CI_YML, job: STATIC_CHECKS_JOB },
	{ path: ci_yml_fixture.TEMPLATE_CI_YML, job: 'checks' },
])('uses devEngines when packageManager is absent in $path', ({ path: workflow_path, job }) => {
	const manifest = {
		devEngines: { packageManager: { name: 'pnpm', version: '11.4.0+sha512.abc' } },
	}

	expect(run_resolver(workflow_path, job, manifest)).toBe('version=11.4.0\n')
})

describe('Node 26 smoke job', () => {
	it('installs pnpm and runs it with Node 26', () => {
		const steps = required_steps(ci_yml_fixture.RUNTIME_CI_YML, NODE_26_JOB)
		const setup = steps.find((step) => step.uses === ACTION)

		expect(setup?.uses).toBe(ACTION)
		expect(setup?.with?.['runtime']).toBe('node@26')
		expect(steps.at(-1)?.run).toContain('pnpm --version')
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
