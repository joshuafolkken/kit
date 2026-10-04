import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ci_yml_fixture } from '#scripts/ci/ci-yml-fixture'
import { workflow_expression_fixture } from '#scripts/ci/workflow-expression-fixture'
import { init_logic } from '#scripts/init/init-logic'
import { afterEach, describe, expect, it } from 'vitest'

const TEMPLATE = 'templates/workflows/github-release.yml'
const KIT_PUBLISH = '.github/workflows/publish.yml'
const RELEASE_STEP = 'Publish GitHub Release'
const SELECT_STEP = 'release'
const TAG = 'v0.107.0'
const RELEASE_COMMAND = 'pnpm josh release:github'

const directories: Array<string> = []

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true })
})

function release_job_condition(): string {
	return ci_yml_fixture.find_job(TEMPLATE, 'release')?.if ?? ''
}

function starts(event_name: string, workflow_run: Record<string, string> = {}): boolean {
	return workflow_expression_fixture.evaluate_condition(release_job_condition(), {
		github: { event_name, event: { workflow_run } },
	})
}

function checkout(has_publish: boolean): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'github-release-'))

	directories.push(directory)

	if (has_publish) {
		mkdirSync(path.join(directory, '.github/workflows'), { recursive: true })
		writeFileSync(path.join(directory, KIT_PUBLISH), 'name: Publish\n')
	}

	return directory
}

// Runs the tag-selection step as the runner would, in a checkout with or without a publish.yml.
function select_outputs(environment: Record<string, string>, has_publish: boolean): string {
	const directory = checkout(has_publish)
	const output = path.join(directory, 'output')

	writeFileSync(output, '')
	const job = ci_yml_fixture.find_job(TEMPLATE, 'release')
	const script = ci_yml_fixture.step_run(ci_yml_fixture.find_step_by_id(job, SELECT_STEP))

	execFileSync('bash', ['-c', script], {
		cwd: directory,
		env: { ...process.env, ...environment, GITHUB_OUTPUT: output },
	})

	return readFileSync(output, 'utf8')
}

describe('distributed GitHub Release workflow', () => {
	it('is written into consumers by init and sync', () => {
		expect(init_logic.get_ai_copy_file_mappings()).toContainEqual({
			src: TEMPLATE,
			dest: '.github/workflows/github-release.yml',
		})
	})

	it('starts after a successful Publish run or a tag announcement', () => {
		const workflow = ci_yml_fixture.read_workflow(TEMPLATE)

		expect(workflow).toMatch(/workflow_run:\n\s+workflows: \[Publish\]\n\s+types: \[completed\]/u)
		expect(workflow).toMatch(/repository_dispatch:\n\s+types: \[new-tag-created\]/u)
	})

	it.each([
		['workflow_run', { conclusion: 'success', display_title: `Publish ${TAG}` }, true],
		['workflow_run', { conclusion: 'failure', display_title: `Publish ${TAG}` }, false],
		['workflow_run', { conclusion: 'success', display_title: 'Publish main' }, false],
		['repository_dispatch', {}, true],
	])('decides whether a %s event %o releases: %s', (event_name, workflow_run, expected) => {
		expect(starts(event_name, workflow_run)).toBe(expected)
	})

	it('runs josh release:github with the selected tag and publish workflow', () => {
		const job = ci_yml_fixture.find_job(TEMPLATE, 'release')
		const step = job?.steps?.find((candidate) => candidate.name === RELEASE_STEP)

		expect(step).toMatchObject({
			run: RELEASE_COMMAND,
			env: {
				GH_TOKEN: '${{ github.token }}',
				RELEASE_TAG: '${{ steps.release.outputs.tag }}',
				RELEASE_WORKFLOW: '${{ steps.release.outputs.workflow }}',
			},
		})
	})
})

describe('release tag selection', () => {
	it('reads the tag and workflow from the Publish run', () => {
		const run = { EVENT_NAME: 'workflow_run', RUN_TITLE: `Publish ${TAG}`, RUN_WORKFLOW: '42' }

		expect(select_outputs(run, true)).toBe(`tag=${TAG}\nworkflow=42\n`)
	})

	it('releases an announced tag in a repository without publish.yml', () => {
		const dispatch = { EVENT_NAME: 'repository_dispatch', DISPATCH_TAG: TAG }

		expect(select_outputs(dispatch, false)).toBe(`tag=${TAG}\n`)
	})

	it('leaves an announced tag to the Publish run when publish.yml exists', () => {
		const dispatch = { EVENT_NAME: 'repository_dispatch', DISPATCH_TAG: TAG }

		expect(select_outputs(dispatch, true)).toBe('')
	})
})

it("keeps kit's own release on its start tag and publish jobs", () => {
	const step = ci_yml_fixture
		.find_job(KIT_PUBLISH, 'create-release')
		?.steps?.find((candidate) => candidate.name === RELEASE_STEP)

	expect(step).toMatchObject({
		run: RELEASE_COMMAND,
		env: {
			RELEASE_START_TAG: 'v1.887.0',
			RELEASE_WORKFLOW: 'publish.yml',
			RELEASE_JOBS: 'publish-github,publish-npm,update-production',
		},
	})
})
