import { readdirSync } from 'node:fs'
import { composite_actions } from '#scripts/ci/composite-actions'
import { package_path } from '#scripts/init/init-paths'
import { describe, expect, it } from 'vitest'
import { ci_yml_fixture, type WorkflowStep } from './ci-yml-fixture'

// Three properties every workflow kit runs or distributes holds (joshuafolkken/kit#3084): a job
// cannot run for GitHub's default six hours, the Node.js version is written once, and a step output
// or event field never reaches a shell script as text.
const WORKFLOW_DIRECTORIES = ['.github/workflows', 'templates/workflows']
const YAML_PATTERN = /\.ya?ml$/u
const SETUP_NODE_ACTION = '.github/actions/setup-node/action.yml'
const SETUP_NODE_UPSTREAM = 'actions/setup-node@'
const NODE_VERSION_INPUT = 'node-version'
// `${{ steps.<id>.outputs.* }}` and `${{ github.event.* }}` interpolated into `run:` are spliced
// into the script before the shell parses it; passed through `env:` they stay data.
const INLINE_EXPANSION_PATTERN = /\$\{\{\s*(?:steps\.|github\.event\.)/u

interface NamedStep {
	file: string
	step: WorkflowStep
}

function workflow_files(): Array<string> {
	return WORKFLOW_DIRECTORIES.flatMap((directory) =>
		readdirSync(package_path(directory))
			.filter((name) => YAML_PATTERN.test(name))
			.map((name) => `${directory}/${name}`),
	)
}

function workflow_steps(): Array<NamedStep> {
	return workflow_files().flatMap((file) =>
		Object.values(ci_yml_fixture.load_workflow(file).jobs).flatMap((job) =>
			(job.steps ?? []).map((step) => ({ file, step })),
		),
	)
}

function action_steps(): Array<NamedStep> {
	return composite_actions
		.list(package_path)
		.flatMap((file) => ci_yml_fixture.load_action(file).runs.steps.map((step) => ({ file, step })))
}

function step_jobs_without_timeout(): Array<string> {
	return workflow_files().flatMap((file) =>
		Object.entries(ci_yml_fixture.load_workflow(file).jobs)
			.filter(([, job]) => job.steps !== undefined)
			.filter(([, job]) => ci_yml_fixture.job_timeout_minutes(job) === undefined)
			.map(([name]) => `${file}:${name}`),
	)
}

function describe_step(entry: NamedStep): string {
	return `${entry.file}: ${entry.step.name ?? entry.step.uses ?? entry.step.run ?? ''}`
}

function steps_setting_node_version(steps: ReadonlyArray<NamedStep>): Array<string> {
	return steps
		.filter((entry) => entry.step.with?.[NODE_VERSION_INPUT] !== undefined)
		.map((entry) => describe_step(entry))
}

describe('workflow hygiene', () => {
	it('finds the workflows and composite actions it guards', () => {
		expect(workflow_files()).toContain('.github/workflows/publish.yml')
		expect(composite_actions.list(package_path)).toContain(SETUP_NODE_ACTION)
	})

	it('gives every job that runs steps a timeout', () => {
		expect(step_jobs_without_timeout()).toEqual([])
	})

	it('sets the Node.js version in the setup-node composite action alone', () => {
		expect(steps_setting_node_version([...workflow_steps(), ...action_steps()])).toEqual([
			`${SETUP_NODE_ACTION}: Setup Node.js`,
		])
	})

	it('calls actions/setup-node from the composite action rather than from a workflow', () => {
		const direct = workflow_steps().filter((entry) =>
			entry.step.uses?.startsWith(SETUP_NODE_UPSTREAM),
		)

		expect(direct.map((entry) => describe_step(entry))).toEqual([])
	})

	it('passes step outputs and event fields to run scripts through env', () => {
		const inline = [...workflow_steps(), ...action_steps()].filter((entry) =>
			INLINE_EXPANSION_PATTERN.test(entry.step.run ?? ''),
		)

		expect(inline.map((entry) => describe_step(entry))).toEqual([])
	})

	it('catches an inline step output in a run script', () => {
		expect(
			INLINE_EXPANSION_PATTERN.test('npm publish --tag ${{ steps.publish-tag.outputs.tag }}'),
		).toBe(true)
		expect(INLINE_EXPANSION_PATTERN.test('npm publish --tag "$PUBLISH_TAG"')).toBe(false)
	})
})
