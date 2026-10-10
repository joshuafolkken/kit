import { readFileSync } from 'node:fs'
import { ci_yml_fixture } from '#scripts/ci/ci-yml-fixture'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const WORKFLOW_PATH = '.github/workflows/publish.yml'
const PACKAGE_GUIDE = 'docs/setup/full.md'
const CLI_GUIDE = 'docs/cli.md'
const AUTHENTICATION_GUIDE = 'docs/authentication.md'
const PACKAGE_API_REFERENCE = 'docs/package-api.md'
const TROUBLESHOOTING_GUIDE = 'docs/troubleshooting.md'
const TEMPLATE_CI_YML = 'templates/workflows/ci.yml'
const PUBLISH_JOB_NAMES = ['publish-github', 'publish-npm'] as const
const GITHUB_AUTH_LINE = '//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}'
const DISPATCH_TAG = '${{ github.ref_name }}'
const TAG_REF_GUARD = "startsWith(github.ref, 'refs/tags/v')"
const PRODUCTION_WORKFLOW = './.github/workflows/production.yml'
const PACKAGE_PUBLISH_GROUP = 'package-publish'
const CHECKOUT_ACTION = 'actions/checkout@'
const SETUP_PNPM_ACTION = './.github/actions/setup-pnpm'
const SETUP_NODE_ACTION = './.github/actions/setup-node'
const PUBLISH_TAG_ARGUMENT = '--tag "$PUBLISH_TAG"'
const MANIFEST_SCHEMA = z.object({
	repository: z.object({ url: z.string() }),
	publishConfig: z.unknown().optional(),
})
const PERMISSIONS_SCHEMA = z.record(z.string(), z.string())
const STEP_SCHEMA = z.looseObject({
	run: z.string().optional(),
	uses: z.string().optional(),
	with: z.record(z.string(), z.unknown()).optional(),
	env: z.record(z.string(), z.string()).optional(),
})
const JOB_SCHEMA = z.object({
	if: z.string().optional(),
	needs: z.unknown().optional(),
	concurrency: z.object({ group: z.string(), queue: z.string() }),
	permissions: PERMISSIONS_SCHEMA,
	steps: z.array(STEP_SCHEMA),
})
const JOBS_SCHEMA = z.object({ 'publish-github': JOB_SCHEMA, 'publish-npm': JOB_SCHEMA })
const PRODUCTION_JOB_SCHEMA = z.object({
	needs: z.array(z.string()),
	uses: z.string(),
	with: z.object({ tag: z.string() }),
})
const RELEASE_JOB_SCHEMA = z.object({
	needs: z.array(z.string()),
	permissions: PERMISSIONS_SCHEMA,
	concurrency: z.unknown().optional(),
	steps: z.array(STEP_SCHEMA),
})
const WORKFLOW_SCHEMA = z.object({
	jobs: JOBS_SCHEMA,
})
const TRIGGER_SCHEMA = z.object({
	'run-name': z.string(),
	on: z.record(z.string(), z.unknown()),
})
const RELEASE_WORKFLOW_SCHEMA = z.object({
	concurrency: z.unknown().optional(),
	jobs: z.object({
		'publish-github': JOB_SCHEMA,
		'publish-npm': JOB_SCHEMA,
		'update-production': PRODUCTION_JOB_SCHEMA,
		'create-release': RELEASE_JOB_SCHEMA,
	}),
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
	it('runs on the tag ref so npm provenance records the tag commit, not the default branch head', () => {
		const workflow = TRIGGER_SCHEMA.parse(load(readFileSync(WORKFLOW_PATH, 'utf8')))

		expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
		// auto-tag.yml leaves any publish.yml mentioning new-tag-created to the repository_dispatch.
		expect(readFileSync(WORKFLOW_PATH, 'utf8')).not.toContain('new-tag-created')
		expect(workflow['run-name']).toBe(`Publish ${DISPATCH_TAG}`)
	})

	it.each(PUBLISH_JOB_NAMES)(
		'publishes the checked-out run commit only from a release tag ref in %s',
		(job_name: 'publish-github' | 'publish-npm') => {
			const job = read_workflow().jobs[job_name]
			const checkout = job.steps.find((step) => step.uses?.startsWith(CHECKOUT_ACTION))

			expect(job.if).toBe(TAG_REF_GUARD)
			expect(checkout).toBeDefined()
			expect(checkout?.with?.['ref']).toBeUndefined()
		},
	)

	it('looks up publish runs of every trigger so pre-migration runs stay visible', () => {
		const source = readFileSync('scripts/release/github-release-runs.ts', 'utf8')

		expect(source).toContain('/runs?per_page=')
		expect(source).not.toContain('event=')
	})
})

describe('dual registry publishing', () => {
	it('leaves registry selection to each publish job', () => {
		const manifest = MANIFEST_SCHEMA.parse(JSON.parse(readFileSync('package.json', 'utf8')))

		expect(manifest.publishConfig).toBeUndefined()
		expect(manifest.repository.url).toContain('github.com/joshuafolkken/kit')
	})

	it('waits only on the shared pack so one publish failure cannot block the other', () => {
		const { jobs } = read_workflow()

		expect(jobs['publish-github'].needs).toBe('pack')
		expect(jobs['publish-npm'].needs).toBe('pack')
	})

	it('keeps GitHub Packages publishing with package write permission', () => {
		const job = read_workflow().jobs['publish-github']
		const commands = job.steps.map((step) => step.run ?? '').join('\n')

		expect(job.permissions['packages']).toBe('write')
		expect(commands).toContain('cd "$RUNNER_TEMP" && npm publish kit.tgz')
		expect(commands).toContain('--registry https://npm.pkg.github.com')
	})

	it('publishes the shared tarball publicly from outside the pnpm project', () => {
		const job = read_workflow().jobs['publish-npm']
		const commands = job.steps.map((step) => step.run ?? '').join('\n')

		expect(job.permissions['id-token']).toBe('write')
		expect(commands).toContain('cd "$RUNNER_TEMP" && npm publish kit.tgz --access public')
		expect(commands).toContain('--registry https://registry.npmjs.org')
		expect(commands).toContain('--userconfig /dev/null')
	})
})

describe('GitHub Release job ordering', () => {
	it('waits for both registries before updating production and waits for all three before publishing', () => {
		const workflow = RELEASE_WORKFLOW_SCHEMA.parse(load(readFileSync(WORKFLOW_PATH, 'utf8')))

		expect(workflow.jobs['update-production'].needs).toEqual(PUBLISH_JOB_NAMES)
		expect(workflow.jobs['create-release'].needs).toEqual([
			...PUBLISH_JOB_NAMES,
			'update-production',
		])
	})

	it('passes the dispatch tag to production and checks out the same tag for the release', () => {
		const workflow = RELEASE_WORKFLOW_SCHEMA.parse(load(readFileSync(WORKFLOW_PATH, 'utf8')))
		const production = workflow.jobs['update-production']
		const release = workflow.jobs['create-release']
		const checkout = release.steps.find((step) => step.uses?.startsWith(CHECKOUT_ACTION))
		const publish = release.steps.find((step) => step.run?.includes('josh release:github'))

		expect(production.uses).toBe(PRODUCTION_WORKFLOW)
		expect(production.with.tag).toBe(DISPATCH_TAG)
		expect(checkout?.with?.['ref']).toBeUndefined()
		expect(publish?.env?.['RELEASE_TAG']).toBe(production.with.tag)
		expect(release.permissions['contents']).toBe('write')
	})
})

describe('release workflow concurrency', () => {
	it('allows release jobs to wait without blocking earlier package jobs', () => {
		const workflow = RELEASE_WORKFLOW_SCHEMA.parse(load(readFileSync(WORKFLOW_PATH, 'utf8')))
		const expected = { group: PACKAGE_PUBLISH_GROUP, queue: 'max' }

		expect(workflow.concurrency).toBeUndefined()
		expect(workflow.jobs['publish-github'].concurrency).toEqual(expected)
		expect(workflow.jobs['publish-npm'].concurrency).toEqual(expected)
		expect(workflow.jobs['create-release'].concurrency).toBeUndefined()

		const checkout = workflow.jobs['create-release'].steps.find((step) =>
			step.uses?.startsWith(CHECKOUT_ACTION),
		)

		expect(checkout?.with?.['fetch-depth']).toBe(0)
		expect(workflow.jobs['create-release'].permissions['actions']).toBe('read')
	})

	it.each(PUBLISH_JOB_NAMES)(
		'selects the registry tag while %s holds the publish queue',
		(job_name) => {
			const job = read_workflow().jobs[job_name]
			const commands = job.steps.map((step) => step.run ?? '').join('\n')
			const publish = job.steps.find((step) => step.run?.includes(PUBLISH_TAG_ARGUMENT))

			expect(job.concurrency.group).toBe(PACKAGE_PUBLISH_GROUP)
			expect(commands).toContain('dist-tags.latest')
			expect(commands).toContain('publish-tag-cli.ts')
			expect(publish?.env?.['PUBLISH_TAG']).toBe('${{ steps.publish-tag.outputs.tag }}')
			expect(commands).not.toContain('--tag latest')
		},
	)

	it('prevents the independent production dispatch from running in kit', () => {
		const production = readFileSync('.github/workflows/production.yml', 'utf8')

		expect(production).toContain("github.repository != 'joshuafolkken/kit' || inputs.tag != ''")
		expect(production).toContain('REF_NAME: ${{ inputs.tag || github.event.client_payload.tag }}')
		expect(production).toContain('group: production-update')
	})
})

describe('registry dist-tag lookup', () => {
	it.each(PUBLISH_JOB_NAMES)(
		'runs the dist-tag lookup outside the repository in %s so npm skips devEngines',
		(job_name) => {
			const lines = read_workflow()
				.jobs[job_name].steps.flatMap((step) => (step.run ?? '').split('\n'))
				.filter((line) => line.includes('npm view'))

			expect(lines.length).toBeGreaterThan(0)
			for (const line of lines) expect(line).toContain('cd "$RUNNER_TEMP" && npm view')
		},
	)

	it.each(PUBLISH_JOB_NAMES)(
		'reads the registry latest in %s before setup-pnpm puts the safe-chain shims on PATH',
		(job_name) => {
			const { steps } = read_workflow().jobs[job_name]
			const lookups = steps.flatMap((step, index) =>
				(step.run ?? '').includes('npm view') ? index : [],
			)
			const setup = steps.findIndex((step) => step.uses === SETUP_PNPM_ACTION)

			expect(setup).toBeGreaterThan(0)
			expect(lookups).toHaveLength(1)
			expect(lookups[0]).toBeLessThan(setup)
		},
	)
})

describe('installation guidance', () => {
	it('starts the README without GitHub Packages authentication', () => {
		const content = readFileSync('README.md', 'utf8')

		expect(content).toContain(
			'pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver @joshuafolkken/kit',
		)
		expect(content).not.toContain('gh auth login --scopes read:packages')
		expect(content).toContain('[Node.js, pnpm and the gh CLI](./docs/setup/prerequisites.md)')
	})

	it.each([CLI_GUIDE, PACKAGE_GUIDE])(
		'uses public npm as the primary installation route in %s',
		(filename: string) => {
			const content = readFileSync(filename, 'utf8')

			expect(content).toContain('public npm registry')
			expect(content).not.toContain('## 1. Authenticate')
		},
	)

	it('keeps the existing GitHub Packages guidance scoped to existing projects', () => {
		const content = readFileSync(AUTHENTICATION_GUIDE, 'utf8')

		expect(content).toContain('Existing GitHub Packages authentication')
		expect(content).toContain('New installations')
	})

	it('identifies the registry used by kit version checks', () => {
		const content = readFileSync(PACKAGE_API_REFERENCE, 'utf8')

		expect(content).toMatch(/public npm, without credentials[^\n]*GitHub Packages versions/u)
	})

	it('keeps the CI credential placeholder guidance in troubleshooting', () => {
		const content = readFileSync(TROUBLESHOOTING_GUIDE, 'utf8')

		expect(content).toContain('kit CI template writes a GitHub Packages credential placeholder')
	})
})

describe('obsolete migration notes', () => {
	it.each([CLI_GUIDE, TROUBLESHOOTING_GUIDE, AUTHENTICATION_GUIDE, 'docs/sync.md'])(
		'carries no migration note for an obsolete kit version in %s',
		(filename: string) => {
			const content = readFileSync(filename, 'utf8')

			expect(content).not.toMatch(/`(?:< |>= )?(?:0\.200|1\.17|1\.60)\.0`/u)
			expect(content).not.toContain('./troubleshooting.md#stale-')
		},
	)
})

describe('publishing guidance', () => {
	it('documents direct publishing and a public-registry verification', () => {
		const content = readFileSync('docs/maintainers/publishing.md', 'utf8')

		expect(content).toContain('direct `npm publish`')
		expect(content).toContain('two-factor authentication')
		expect(content).toContain('pnpm pkg delete publishConfig')
		expect(content).toContain("'--@joshuafolkken:registry=https://registry.npmjs.org'")
		expect(content).toContain('https://registry.npmjs.org/@joshuafolkken%2fkit')
	})
})

describe('registry error guidance', () => {
	it('distinguishes a missing public npm release from GitHub Packages routing', () => {
		const content = readFileSync(TROUBLESHOOTING_GUIDE, 'utf8')

		expect(content).toContain('For a new kit-only install, public npm is the expected registry')
		expect(content).toContain('https://registry.npmjs.org/@joshuafolkken%2fkit/<version>')
		expect(content).toContain('For an existing project intentionally using GitHub Packages')
	})
})

describe('new project CI registry', () => {
	it.each(['checks', 'e2e'])('keeps public npm as default in %s', (job_name: string) => {
		const steps = template_steps(job_name)
		const setup = steps.find((step) => step.name === 'Setup Node.js')
		const auth_index = command_index(steps, GITHUB_AUTH_LINE)
		const install_index = steps.findIndex((step) => step.uses === SETUP_PNPM_ACTION)

		expect(setup).toMatchObject({ uses: SETUP_NODE_ACTION })
		expect(setup).not.toHaveProperty(['with', 'registry-url'])
		expect(auth_index).toBeGreaterThanOrEqual(0)
		expect(install_index).toBeGreaterThan(auth_index)
		expect(steps[install_index]?.with?.['node-auth-token']).toContain('GITHUB_TOKEN')
	})
})
