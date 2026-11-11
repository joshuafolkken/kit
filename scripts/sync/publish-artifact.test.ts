import { readFileSync } from 'node:fs'
import { ci_yml_fixture, type WorkflowJob, type WorkflowStep } from '#scripts/ci/ci-yml-fixture'
import { describe, expect, it } from 'vitest'

// Both registries receive the one tarball the `pack` job builds, so the same version can never
// carry different bytes on GitHub Packages and on npm (joshuafolkken/kit#3268).
const WORKFLOW_PATH = '.github/workflows/publish.yml'
const PACK_JOB = 'pack'
const PUBLISH_JOB_NAMES = ['publish-github', 'publish-npm'] as const
const ARTIFACT_NAME = 'npm-package'
const TARBALL_OUTPUT = '${{ steps.package.outputs.tarball }}'
const PACKAGE_OUTPUT = '${{ steps.package.outputs.package }}'
const KIT_NAMES = [
	'view @joshuafolkken/kit',
	'publish @joshuafolkken/kit',
	'kit.tgz',
	'kit-package',
] as const
const UPLOAD_ACTION = 'actions/upload-artifact@'
const DOWNLOAD_ACTION = 'actions/download-artifact@'
const BUILDING_COMMANDS = ['pnpm pack', 'pnpm publish', 'pnpm build'] as const
// How long GitHub lets a workflow run be re-run; a re-run of a failed publish job downloads the
// tarball the original attempt uploaded.
const RERUN_WINDOW_DAYS = 30

function job(job_name: string): WorkflowJob {
	const found = ci_yml_fixture.find_job(WORKFLOW_PATH, job_name)
	if (found === undefined) throw new Error(`publish.yml declares no ${job_name} job`)

	return found
}

function steps_using(target: WorkflowJob, action: string): Array<WorkflowStep> {
	return (target.steps ?? []).filter((step) => step.uses?.startsWith(action) === true)
}

function commands(target: WorkflowJob): string {
	return (target.steps ?? []).map((step) => step.run ?? '').join('\n')
}

describe('publish.yml — one built artifact for both registries', () => {
	it('packs the tarball once and uploads it under the shared artifact name', () => {
		const pack = job(PACK_JOB)
		const uploads = steps_using(pack, UPLOAD_ACTION)

		expect(commands(pack)).toContain('pnpm pack --out "$RUNNER_TEMP/$TARBALL"')
		expect(uploads).toHaveLength(1)
		expect(uploads[0]?.with?.['name']).toBe(ARTIFACT_NAME)
		expect(uploads[0]?.with?.['path']).toBe(`\${{ runner.temp }}/${TARBALL_OUTPUT}`)
	})

	it('keeps the tarball for as long as a failed publish job can be re-run', () => {
		const [upload] = steps_using(job(PACK_JOB), UPLOAD_ACTION)

		expect(upload?.with?.['retention-days']).toBe(RERUN_WINDOW_DAYS)
	})

	it('keeps publish credentials out of the job that builds', () => {
		expect(job(PACK_JOB).permissions).toEqual({ contents: 'read' })
	})

	it.each(PUBLISH_JOB_NAMES)('publishes the downloaded tarball in %s', (job_name) => {
		const target = job(job_name)
		const downloads = steps_using(target, DOWNLOAD_ACTION)

		expect(target.needs).toBe(PACK_JOB)
		expect(downloads).toHaveLength(1)
		expect(downloads[0]?.with?.['name']).toBe(ARTIFACT_NAME)
		expect(downloads[0]?.with?.['path']).toBe('${{ runner.temp }}')
		expect(commands(target)).toContain('cd "$RUNNER_TEMP" && npm publish "$TARBALL"')
	})

	it.each(PUBLISH_JOB_NAMES)('builds nothing of its own in %s', (job_name) => {
		const script = commands(job(job_name))

		for (const command of BUILDING_COMMANDS) expect(script).not.toContain(command)
	})
})

function steps_with_run(target: WorkflowJob, text: string): Array<WorkflowStep> {
	return (target.steps ?? []).filter((step) => step.run?.includes(text) === true)
}

function publish_step_environment(job_name: string): Record<string, string> {
	return steps_with_run(job(job_name), 'npm publish').at(0)?.env ?? {}
}

// kit and every kit that publishes to npm run this one file (#7303), so neither name is written in it.
// The installed kit's own path (`node_modules/@joshuafolkken/kit/`) is not the package published.
describe('publish.yml — names read from package.json', () => {
	it('reads the package and tarball names in pack', () => {
		const pack = job(PACK_JOB)

		expect(commands(pack)).toContain(`require('./package.json').name`)
		expect(pack.outputs?.['package']).toBe(PACKAGE_OUTPUT)
		expect(pack.outputs?.['tarball']).toBe(TARBALL_OUTPUT)
	})

	it.each(PUBLISH_JOB_NAMES)('publishes the tarball pack named in %s', (job_name) => {
		expect(publish_step_environment(job_name)['TARBALL']).toBe('${{ needs.pack.outputs.tarball }}')
	})

	it.each(KIT_NAMES)('writes no %s into the workflow', (name) => {
		expect(readFileSync(WORKFLOW_PATH, 'utf8')).not.toContain(name)
	})
})
