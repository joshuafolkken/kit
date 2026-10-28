import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const WORKFLOW_PATH = '.github/workflows/publish.yml'
const PUBLISH_JOB_NAMES = ['publish-github', 'publish-npm'] as const
const PACKAGE_PUBLISH_GROUP = 'package-publish'
const SETUP_PNPM_ACTION = './.github/actions/setup-pnpm'
const PUBLISH_TAG_ARGUMENT = '--tag "$PUBLISH_TAG"'
const LATEST_LOOKUP = 'dist-tags.latest'
const KIT_SCOPE = '@joshuafolkken'
const GITHUB_PACKAGES_REGISTRY = 'https://npm.pkg.github.com'
const LATEST_VIEW = `npm view ${KIT_SCOPE}/kit dist-tags.latest`
// What `npm config get` prints for a key no config sets — an npm that failed to run prints nothing.
const UNSET_CONFIG = 'undefined'
const SCOPE_REGISTRY_READ = `npm config get ${KIT_SCOPE}:registry`
const VERSION_ORDER_CHECK = String.raw`printf '%s\n%s\n' "$latest" "$VERSION" | sort -V -C`
const STEP_SCHEMA = z.object({
	if: z.string().optional(),
	run: z.string().optional(),
	uses: z.string().optional(),
	env: z.record(z.string(), z.string()).optional(),
})
const PUBLISH_JOB_SCHEMA = z.object({
	concurrency: z.object({ group: z.string() }),
	steps: z.array(STEP_SCHEMA),
})
const STRING_MAP_SCHEMA = z.record(z.string(), z.string())
const PACK_JOB_SCHEMA = z.object({
	permissions: STRING_MAP_SCHEMA,
	outputs: STRING_MAP_SCHEMA,
	steps: z.array(STEP_SCHEMA),
})
const WORKFLOW_SCHEMA = z.object({
	jobs: z.object({
		pack: PACK_JOB_SCHEMA,
		'publish-github': PUBLISH_JOB_SCHEMA,
		'publish-npm': PUBLISH_JOB_SCHEMA,
	}),
})

function read_workflow(): z.infer<typeof WORKFLOW_SCHEMA> {
	return WORKFLOW_SCHEMA.parse(load(readFileSync(WORKFLOW_PATH, 'utf8')))
}

// joshuafolkken/kit#4633: the tag is chosen in the credential-free `pack`, so the jobs holding the
// publish rights run no repository code.
describe('publish tag selection', () => {
	it('selects the registry tag in pack, which holds no credentials', () => {
		const { pack } = read_workflow().jobs
		const commands = pack.steps.map((step) => step.run ?? '').join('\n')

		expect(pack.permissions).toEqual({ contents: 'read' })
		expect(pack.outputs['tag']).toBe('${{ steps.publish-tag.outputs.tag }}')
		expect(commands).toContain(LATEST_LOOKUP)
		expect(commands).toContain('publish-tag-cli.ts')
	})

	it.each(PUBLISH_JOB_NAMES)(
		'publishes the tag pack chose while %s holds the queue',
		(job_name) => {
			const job = read_workflow().jobs[job_name]
			const commands = job.steps.map((step) => step.run ?? '').join('\n')
			const publish = job.steps.find((step) => step.run?.includes(PUBLISH_TAG_ARGUMENT))

			expect(job.concurrency.group).toBe(PACKAGE_PUBLISH_GROUP)
			expect(publish?.env?.['PUBLISH_TAG']).toBe('${{ needs.pack.outputs.tag }}')
			expect(commands).not.toContain('tsx')
			expect(commands).not.toContain('--tag latest')
		},
	)
})

// joshuafolkken/kit#2660: `pack` reads `latest` outside the queue, so a run that chose `latest`
// re-reads it under the queue and stops only if another run moved it above this run's version.
describe('publish queue latest check', () => {
	it.each(PUBLISH_JOB_NAMES)(
		'stops %s before publishing latest when npm latest moved above its version',
		(job_name) => {
			const { steps } = read_workflow().jobs[job_name]
			const check = steps.findIndex((step) => step.run?.includes(LATEST_LOOKUP))
			const publish = steps.findIndex((step) => step.run?.includes(PUBLISH_TAG_ARGUMENT))
			const step = steps[check]

			expect(check).toBeGreaterThan(0)
			expect(check).toBeLessThan(publish)
			expect(step?.if).toBe("needs.pack.outputs.tag == 'latest'")
		},
	)

	it.each(PUBLISH_JOB_NAMES)('compares npm latest with the version pack read in %s', (job_name) => {
		const step = read_workflow().jobs[job_name].steps.find((entry) =>
			entry.run?.includes(LATEST_LOOKUP),
		)

		expect(step?.env).toEqual({ VERSION: '${{ needs.pack.outputs.version }}' })
		expect(step?.run).toContain('--registry https://registry.npmjs.org --userconfig /dev/null')
		expect(step?.run).toContain(VERSION_ORDER_CHECK)
		expect(step?.run).toContain('exit 1')
	})

	it.each([
		['an older tag published in between', '1.9.0', '1.10.0', true],
		['this run already published', '1.10.0', '1.10.0', true],
		['a newer tag published in between', '1.11.0', '1.10.0', false],
	])('lets the run continue when %s', (_label, latest, version, is_valid) => {
		const result = spawnSync('sh', ['-c', VERSION_ORDER_CHECK], {
			env: { ...process.env, latest, VERSION: version },
		})

		expect(result.status === 0).toBe(is_valid)
	})
})

function read_lookup_lines(job_name: 'pack' | (typeof PUBLISH_JOB_NAMES)[number]): Array<string> {
	return read_workflow()
		.jobs[job_name].steps.flatMap((step) => (step.run ?? '').split('\n'))
		.filter((line) => line.includes('npm view'))
}

// Runs a lookup line with `npm view` swapped for a config read, from a `$RUNNER_TEMP` holding the
// scoped `.npmrc` setup-node writes, and prints the registry the scope resolved to.
function resolve_scope_registry(line: string): string {
	const runner_temporary = mkdtempSync(path.join(tmpdir(), 'publish-lookup-'))
	const npmrc = path.join(runner_temporary, '.npmrc')

	writeFileSync(npmrc, `${KIT_SCOPE}:registry=${GITHUB_PACKAGES_REGISTRY}\n`)
	const command = line.replace(LATEST_VIEW, () => SCOPE_REGISTRY_READ)
	const result = spawnSync('sh', ['-c', `${command}\necho "$latest"`], {
		encoding: 'utf8',
		env: { ...process.env, RUNNER_TEMP: runner_temporary, NPM_CONFIG_USERCONFIG: npmrc },
	})

	rmSync(runner_temporary, { recursive: true, force: true })

	return result.stdout.trim()
}

describe('registry dist-tag lookup', () => {
	it.each(['pack', ...PUBLISH_JOB_NAMES] as const)(
		'runs the dist-tag lookup in an empty directory in %s so npm skips devEngines and .npmrc',
		(job_name) => {
			const lines = read_lookup_lines(job_name)

			expect(lines.length).toBeGreaterThan(0)
			for (const line of lines) expect(line).toContain('cd "$(mktemp -d)" && npm view')
		},
	)

	// joshuafolkken/kit#5376: from `$RUNNER_TEMP`, npm read setup-node's `.npmrc` as the project
	// config, so publish-github's lookup went to GitHub Packages without a token and failed with 401.
	it.each(PUBLISH_JOB_NAMES)(
		'keeps the scoped registry setup-node wrote from redirecting the lookup in %s',
		(job_name) => {
			const lines = read_lookup_lines(job_name)

			expect(lines.length).toBeGreaterThan(0)

			for (const line of lines) {
				expect(line).toContain(LATEST_VIEW)
				expect(resolve_scope_registry(line)).toBe(UNSET_CONFIG)
			}
		},
	)

	it('reads the registry latest in pack before setup-pnpm puts the safe-chain shims on PATH', () => {
		const { steps } = read_workflow().jobs.pack
		const lookups = steps.flatMap((step, index) =>
			(step.run ?? '').includes('npm view') ? index : [],
		)
		const setup = steps.findIndex((step) => step.uses === SETUP_PNPM_ACTION)

		expect(setup).toBeGreaterThan(0)
		expect(lookups).toHaveLength(1)
		expect(lookups[0]).toBeLessThan(setup)
	})
})
