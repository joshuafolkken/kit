import { readFileSync } from 'node:fs'
import { ci_yml_fixture } from '#scripts/ci/ci-yml-fixture'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const WORKFLOW_PATH = '.github/workflows/publish.yml'
const PACKAGE_GUIDE = 'docs/package.md'
const TROUBLESHOOTING_GUIDE = 'docs/troubleshooting.md'
const TEMPLATE_CI_YML = 'templates/workflows/ci.yml'
const PUBLISH_JOB_NAMES = ['publish-github', 'publish-npm'] as const
const GITHUB_AUTH_LINE = '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}'
const MANIFEST_SCHEMA = z.object({
	repository: z.object({ url: z.string() }),
	publishConfig: z.unknown().optional(),
})
const PERMISSIONS_SCHEMA = z.record(z.string(), z.string())
const STEP_SCHEMA = z.looseObject({
	run: z.string().optional(),
	uses: z.string().optional(),
	with: z.record(z.string(), z.unknown()).optional(),
})
const JOB_SCHEMA = z.object({
	needs: z.unknown().optional(),
	permissions: PERMISSIONS_SCHEMA,
	steps: z.array(STEP_SCHEMA),
})
const JOBS_SCHEMA = z.object({ 'publish-github': JOB_SCHEMA, 'publish-npm': JOB_SCHEMA })
const WORKFLOW_SCHEMA = z.object({
	jobs: JOBS_SCHEMA,
})
type TemplateSteps = NonNullable<NonNullable<ReturnType<typeof ci_yml_fixture.find_job>>['steps']>

function read_workflow(): z.infer<typeof WORKFLOW_SCHEMA> {
	return WORKFLOW_SCHEMA.parse(load(readFileSync(WORKFLOW_PATH, 'utf8')))
}

function template_steps(job_name: string): TemplateSteps {
	const steps = ci_yml_fixture.find_job(TEMPLATE_CI_YML, job_name)?.steps
	if (steps === undefined) throw new Error(`Missing template steps in ${job_name}`)

	return steps
}

function command_index(steps: TemplateSteps, marker: string): number {
	return steps.findIndex((step) => step.run?.includes(marker))
}

describe('release tag checkout', () => {
	it.each(PUBLISH_JOB_NAMES)(
		'publishes the dispatched release tag in %s',
		(job_name: 'publish-github' | 'publish-npm') => {
			const checkout = read_workflow().jobs[job_name].steps.find((step) =>
				step.uses?.startsWith('actions/checkout@'),
			)

			expect(checkout?.with?.['ref']).toBe('${{ github.event.client_payload.tag }}')
		},
	)
})

describe('dual registry publishing', () => {
	it('leaves registry selection to each publish job', () => {
		const manifest = MANIFEST_SCHEMA.parse(JSON.parse(readFileSync('package.json', 'utf8')))

		expect(manifest.publishConfig).toBeUndefined()
		expect(manifest.repository.url).toContain('github.com/joshuafolkken/kit')
	})

	it('starts independent publish jobs so one failure cannot block the other', () => {
		const { jobs } = read_workflow()

		expect(jobs['publish-github'].needs).toBeUndefined()
		expect(jobs['publish-npm'].needs).toBeUndefined()
	})

	it('keeps GitHub Packages publishing with package write permission', () => {
		const job = read_workflow().jobs['publish-github']
		const commands = job.steps.map((step) => step.run ?? '').join('\n')

		expect(job.permissions['packages']).toBe('write')
		expect(commands).toContain('pnpm publish')
		expect(commands).toContain('--registry https://npm.pkg.github.com')
	})

	it('packs once and publishes publicly from outside the pnpm project', () => {
		const job = read_workflow().jobs['publish-npm']
		const commands = job.steps.map((step) => step.run ?? '').join('\n')

		expect(job.permissions['id-token']).toBe('write')
		expect(commands).toContain('pnpm pack --out "$RUNNER_TEMP/kit.tgz"')
		expect(commands).toContain('cd "$RUNNER_TEMP" && npm publish kit.tgz --access public')
		expect(commands).toContain('--registry https://registry.npmjs.org')
		expect(commands).toContain('--userconfig /dev/null')
	})
})

describe('installation guidance', () => {
	it('starts the README without GitHub Packages authentication', () => {
		const content = readFileSync('README.md', 'utf8')

		expect(content).toContain('pnpm add -g @joshuafolkken/kit')
		expect(content).not.toContain('gh auth login --scopes read:packages')
	})

	it.each(['docs/cli.md', PACKAGE_GUIDE])(
		'uses public npm as the primary installation route in %s',
		(filename: string) => {
			const content = readFileSync(filename, 'utf8')

			expect(content).toContain('public npm registry')
			expect(content).not.toContain('## 1. Authenticate')
		},
	)

	it('keeps the existing GitHub Packages guidance scoped to existing projects', () => {
		const content = readFileSync('docs/authentication.md', 'utf8')

		expect(content).toContain('Existing GitHub Packages authentication')
		expect(content).toContain('New installations')
	})

	it('identifies the registry used by kit version checks', () => {
		const content = readFileSync(PACKAGE_GUIDE, 'utf8')

		expect(content).toContain('GitHub Packages versions API')
	})

	it('keeps the troubleshooting link on the renamed migration section', () => {
		const content = readFileSync(TROUBLESHOOTING_GUIDE, 'utf8')

		expect(content).toContain('./cli.md#3-migrating-from-older-versions')
		expect(content).toContain('kit CI template writes a GitHub Packages credential placeholder')
	})

	it('documents direct publishing and a public-registry verification', () => {
		const content = readFileSync('docs/publishing.md', 'utf8')

		expect(content).toContain('direct `npm publish`')
		expect(content).toContain('https://registry.npmjs.org/@joshuafolkken%2fkit')
	})
})

describe('registry error guidance', () => {
	it('distinguishes a missing public npm release from GitHub Packages routing', () => {
		const content = readFileSync(TROUBLESHOOTING_GUIDE, 'utf8')

		expect(content).toContain('For a new kit-only install, public npm is the expected registry')
		expect(content).toContain('For an existing project intentionally using GitHub Packages')
	})
})

describe('new project CI registry', () => {
	it.each(['checks', 'e2e'])('keeps public npm as default in %s', (job_name: string) => {
		const steps = template_steps(job_name)
		const setup = steps.find((step) => step.name === 'Setup Node.js')
		const auth_index = command_index(steps, GITHUB_AUTH_LINE)
		const install_index = command_index(steps, 'pnpm install')

		expect(setup?.with).not.toHaveProperty('registry-url')
		expect(auth_index).toBeGreaterThanOrEqual(0)
		expect(install_index).toBeGreaterThan(auth_index)
		expect(steps[install_index]?.env?.['NODE_AUTH_TOKEN']).toContain('GITHUB_TOKEN')
	})
})
