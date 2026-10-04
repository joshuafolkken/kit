import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ci_yml_fixture } from '#scripts/ci/ci-yml-fixture'
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

	// A Publish run started by the GITHUB_TOKEN never fires workflow_run (joshuafolkken/kit#3138), and
	// a second trigger would start a second release for the same tag.
	it('starts from the tag announcement alone', () => {
		const workflow = ci_yml_fixture.read_workflow(TEMPLATE)

		expect(workflow).toMatch(/repository_dispatch:\n\s+types: \[new-tag-created\]/u)
		expect(workflow).not.toContain('workflow_run:')
		expect(ci_yml_fixture.find_job(TEMPLATE, 'release')?.if).toBeUndefined()
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
				RELEASE_AWAIT_PUBLISH: '${{ steps.release.outputs.await }}',
			},
		})
	})
})

describe('release tag selection', () => {
	const dispatch = { DISPATCH_TAG: TAG }

	it('releases an announced tag at once in a repository without publish.yml', () => {
		expect(select_outputs(dispatch, false)).toBe(`tag=${TAG}\n`)
	})

	it('waits for the Publish run of an announced tag when publish.yml exists', () => {
		expect(select_outputs(dispatch, true)).toBe(`tag=${TAG}\nworkflow=publish.yml\nawait=true\n`)
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
