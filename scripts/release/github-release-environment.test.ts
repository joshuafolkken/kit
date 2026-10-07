import { VERSIONING_COMMANDS } from '#scripts/josh/josh-commands-versioning'
import { describe, expect, it } from 'vitest'
import { github_release_environment } from './github-release-environment'

const REPOSITORY = 'acme/app'
const START_TAG = 'v1.887.0'
const WORKFLOW = 'publish.yml'
const RELEASE_RUN_WORKFLOW = 'github-release.yml'
const REQUIRED = { GH_TOKEN: 'token', RELEASE_TAG: 'v1.0.0', GITHUB_REPOSITORY: REPOSITORY }
const UNSET_SETTINGS = {
	repository: REPOSITORY,
	start_tag: undefined,
	workflow: undefined,
	jobs: [],
	await_publish: false,
	release_run_workflow: undefined,
}

describe('release:github environment', () => {
	it('reads the repository and leaves unset settings undefined', () => {
		const input = github_release_environment.read_release_input({
			...REQUIRED,
			RELEASE_START_TAG: '',
			RELEASE_WORKFLOW: '',
		})

		expect(input).toEqual({ token: 'token', tag: 'v1.0.0', settings: UNSET_SETTINGS })
	})

	it('reads the start tag, workflows and comma-separated job names', () => {
		const input = github_release_environment.read_release_input({
			...REQUIRED,
			RELEASE_START_TAG: START_TAG,
			RELEASE_WORKFLOW: WORKFLOW,
			RELEASE_JOBS: 'publish-github, publish-npm,,update-production',
			RELEASE_RUN_WORKFLOW,
		})

		expect(input.settings).toEqual({
			repository: REPOSITORY,
			start_tag: START_TAG,
			workflow: WORKFLOW,
			jobs: ['publish-github', 'publish-npm', 'update-production'],
			await_publish: false,
			release_run_workflow: RELEASE_RUN_WORKFLOW,
		})
	})
})

it.each(['GH_TOKEN', 'RELEASE_TAG', 'GITHUB_REPOSITORY'])('requires %s', (name) => {
	expect(() => github_release_environment.read_release_input({ ...REQUIRED, [name]: '' })).toThrow(
		'GH_TOKEN, RELEASE_TAG and GITHUB_REPOSITORY are required',
	)
})

it.each([
	['true', true],
	['', false],
	['false', false],
])('reads RELEASE_AWAIT_PUBLISH %o as %s', (value, expected) => {
	const input = github_release_environment.read_release_input({
		...REQUIRED,
		RELEASE_AWAIT_PUBLISH: value,
	})

	expect(input.settings.await_publish).toBe(expected)
})

it('is the command the release workflows run', () => {
	expect(VERSIONING_COMMANDS['release:github']?.script).toBe(
		'scripts/release/github-release-cli.ts',
	)
})
